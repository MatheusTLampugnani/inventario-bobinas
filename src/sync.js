// src/sync.js — Motor de sincronização Offline-First (IndexedDB -> Supabase).
//
// Regras:
//   - Sessões e leituras recebem um uuid gerado no aparelho. O envio usa upsert com
//     "ignoreDuplicates", então reenviar após uma queda de rede nunca duplica registros.
//   - Sessões criadas no aparelho são enviadas antes das leituras (FK sessao_id).
//   - Erro de rede/servidor: a fila para e tenta de novo depois, sem perder nada.
//   - Erro de dados em uma leitura: só ela é marcada como 'erro'; o restante da fila segue.
import db from './db.js';
import { supabase } from './supabase.js';

const TAMANHO_LOTE_ENVIO = 200;
const DIAS_RETENCAO_SINCRONIZADAS = 7;
const TIMEOUT_REDE_MS = 15000;

export const gerarUuid = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback para contextos sem crypto.randomUUID (HTTP sem TLS em navegadores antigos)
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

// Cancela a requisição se a rede travar (Wi-Fi de galpão "conectado" mas sem internet).
export const sinalTimeout = (ms = TIMEOUT_REDE_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  timer?.unref?.(); // Node (testes): não segura o processo aberto; no navegador é um número
  return controller.signal;
};

// Erros de dados (classe 22 = valor inválido, 23 = integridade/FK, PGRST204 = coluna inexistente)
// nunca vão passar reenviando. Todo o resto (rede, timeout, 5xx, permissão) é tratado como temporário.
export const ehErroPermanente = (error) => {
  const code = String(error?.code || '');
  return /^2[23]/.test(code) || code === 'PGRST204';
};

const descreverErro = (error) => [error?.code, error?.message].filter(Boolean).join(' — ') || 'erro desconhecido';

// ---------------------------------------------------------------------------
// Sessões
// ---------------------------------------------------------------------------

/** Cria uma sessão no aparelho. Não depende de rede; vai para o servidor na próxima sincronização. */
export async function registrarSessaoLocal(cracha) {
  const id = gerarUuid();
  await db.sessoes_pendentes.put({ id, cracha: String(cracha), criadoEm: Date.now() });
  return id;
}

export async function sessaoPendenteLocal(id) {
  if (!id) return false;
  return !!(await db.sessoes_pendentes.get(id));
}

/**
 * Converte um id legado `offline-<timestamp>` (versões anteriores do app) em um uuid válido,
 * registrando a sessão para envio e corrigindo as leituras que estavam presas com esse id.
 */
export async function migrarSessaoLegada(offlineId, cracha) {
  if (!String(offlineId || '').startsWith('offline-')) return offlineId;
  return db.transaction('rw', db.sessoes_offline, db.sessoes_pendentes, db.leituras_pendentes, async () => {
    const existente = await db.sessoes_offline.get(offlineId);
    if (existente) return existente.realId;

    const leituraExemplo = await db.leituras_pendentes.where('sessao_id').equals(offlineId).first();
    const timestamp = Number(String(offlineId).replace('offline-', '')) || Date.now();
    const realId = gerarUuid();
    await db.sessoes_pendentes.put({ id: realId, cracha: String(cracha || leituraExemplo?.cracha_leitura || ''), criadoEm: timestamp });
    await db.sessoes_offline.put({ offlineId, realId });
    await db.leituras_pendentes.where('sessao_id').equals(offlineId).modify({ sessao_id: realId });
    return realId;
  });
}

async function migrarSessoesLegadasDaFila() {
  const legadas = new Set();
  await db.leituras_pendentes.each(l => {
    if (String(l.sessao_id || '').startsWith('offline-')) legadas.add(l.sessao_id);
  });
  for (const offlineId of legadas) await migrarSessaoLegada(offlineId);
}

/** Envia ao servidor as sessões criadas no aparelho. Retorna { ok, error }. */
export async function enviarSessoesPendentes() {
  const sessoes = await db.sessoes_pendentes.toArray();
  if (sessoes.length === 0) return { ok: true };

  let erroPermanente = null;
  for (const s of sessoes) {
    const { error } = await supabase
      .from('sessoes_inventario')
      .upsert([{ id: s.id, cracha_importacao: s.cracha, status: 'Em andamento', data_importacao: new Date(s.criadoEm).toISOString() }], { onConflict: 'id', ignoreDuplicates: true })
      .abortSignal(sinalTimeout());
    if (!error) {
      await db.sessoes_pendentes.delete(s.id);
    } else if (ehErroPermanente(error)) {
      // Ex.: crachá removido do cadastro. As leituras dessa sessão ficarão marcadas com erro.
      console.error(`[Sync] Sessão ${s.id} rejeitada pelo servidor:`, descreverErro(error));
      erroPermanente = error;
    } else {
      console.warn('[Sync] Falha de rede ao criar sessão no servidor:', descreverErro(error));
      return { ok: false, error };
    }
  }
  return erroPermanente ? { ok: false, error: erroPermanente } : { ok: true };
}

// ---------------------------------------------------------------------------
// Leituras
// ---------------------------------------------------------------------------

// Remove os campos internos do Dexie e usa o uuid local como id definitivo.
// data_leitura = momento real da bipagem (e não o momento em que a rede voltou).
const paraPayload = ({ id: _idLocal, uuid, _status, _criado_em, _erro, _sincronizado_em, ...dado }) => ({
  ...dado,
  id: uuid,
  data_leitura: dado.data_leitura || new Date(_criado_em || Date.now()).toISOString(),
});

const enviarParaServidor = (registros) => supabase
  .from('bobinas_lidas')
  .upsert(registros.map(paraPayload), { onConflict: 'id', ignoreDuplicates: true })
  .abortSignal(sinalTimeout());

const marcarSincronizadas = (registros) => db.leituras_pendentes
  .where('id').anyOf(registros.map(r => r.id))
  .modify({ _status: 'sincronizado', _sincronizado_em: Date.now() });

async function enviarLote(registros) {
  const { error } = await enviarParaServidor(registros);
  if (!error) {
    await marcarSincronizadas(registros);
    return true;
  }
  if (!ehErroPermanente(error)) {
    console.warn('[Sync] Servidor indisponível, nova tentativa depois:', descreverErro(error));
    return false;
  }

  // Erro de dados: envia uma a uma para isolar só a(s) leitura(s) com problema.
  for (const registro of registros) {
    const { error: erroUnitario } = await enviarParaServidor([registro]);
    if (!erroUnitario) {
      await marcarSincronizadas([registro]);
    } else if (ehErroPermanente(erroUnitario)) {
      console.error(`[Sync] Leitura ${registro.lote} rejeitada pelo servidor:`, descreverErro(erroUnitario));
      await db.leituras_pendentes.update(registro.id, { _status: 'erro', _erro: descreverErro(erroUnitario) });
    } else {
      return false;
    }
  }
  return true;
}

async function limparSincronizadasAntigas() {
  const limite = Date.now() - DIAS_RETENCAO_SINCRONIZADAS * 24 * 60 * 60 * 1000;
  await db.leituras_pendentes
    .where('_status').equals('sincronizado')
    .and(r => (r._sincronizado_em || r._criado_em || 0) < limite)
    .delete();
}

async function executarSincronizacao() {
  await migrarSessoesLegadasDaFila();

  const sessoes = await enviarSessoesPendentes();
  if (!sessoes.ok && !ehErroPermanente(sessoes.error)) return false;

  const pendentes = await db.leituras_pendentes.where('_status').equals('pendente').sortBy('_criado_em');
  for (const p of pendentes) {
    if (!p.uuid) {
      p.uuid = gerarUuid();
      await db.leituras_pendentes.update(p.id, { uuid: p.uuid });
    }
  }

  let enviadas = 0;
  for (let i = 0; i < pendentes.length; i += TAMANHO_LOTE_ENVIO) {
    const lote = pendentes.slice(i, i + TAMANHO_LOTE_ENVIO);
    if (!(await enviarLote(lote))) return false;
    enviadas += lote.length;
  }
  if (enviadas > 0) console.log(`[Sync] ${enviadas} leitura(s) processada(s).`);

  await limparSincronizadasAntigas();
  return true;
}

// Execução única: chamadas durante uma sincronização agendam mais uma rodada ao final.
let sincronizacaoAtual = null;
let novaRodadaSolicitada = false;

export function sincronizar() {
  if (sincronizacaoAtual) {
    novaRodadaSolicitada = true;
    return sincronizacaoAtual;
  }
  sincronizacaoAtual = (async () => {
    try {
      let sucesso;
      do {
        novaRodadaSolicitada = false;
        if (!navigator.onLine) return;
        sucesso = await executarSincronizacao();
      } while (sucesso && novaRodadaSolicitada);
    } catch (err) {
      console.error('[Sync] Erro inesperado na sincronização:', err);
    } finally {
      sincronizacaoAtual = null;
    }
  })();
  return sincronizacaoAtual;
}

/** Aguarda a sincronização em andamento (se houver) terminar. */
export const aguardarSincronizacao = () => sincronizacaoAtual || Promise.resolve();
