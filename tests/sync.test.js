// Testes do motor de sincronização offline (src/sync.js) com IndexedDB simulado e Supabase falso.
import 'fake-indexeddb/auto';
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });

// Supabase falso: registra as chamadas e responde conforme `responder`
const chamadas = [];
let responder = () => ({ error: null });
const supabaseFalso = {
  from(tabela) {
    return {
      upsert(linhas, opcoes) {
        const resultado = Promise.resolve().then(() => {
          chamadas.push({ tabela, linhas, opcoes });
          return responder(tabela, linhas);
        });
        return { abortSignal: () => resultado };
      },
    };
  },
};
mock.module(new URL('../src/supabase.js', import.meta.url).href, { exports: { supabase: supabaseFalso } });

const { sincronizar, registrarSessaoLocal } = await import('../src/sync.js');
const { default: db } = await import('../src/db.js');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const erroDeRede = { message: 'TypeError: Failed to fetch', code: '' };

beforeEach(async () => {
  chamadas.length = 0;
  responder = () => ({ error: null });
  await Promise.all([db.leituras_pendentes.clear(), db.sessoes_pendentes.clear(), db.sessoes_offline.clear()]);
});

const leitura = (lote, extra = {}) => ({
  sessao_id: 'sessao-x', lote, cracha_leitura: '123', filial: '1001', _status: 'pendente', _criado_em: 1700000000000, ...extra,
});

test('sessão legada "offline-..." vira uuid e as leituras presas finalmente sincronizam', async () => {
  await db.leituras_pendentes.bulkAdd([
    leitura('VA111111', { sessao_id: 'offline-1700000000000' }),
    leitura('VA222222', { sessao_id: 'offline-1700000000000' }),
  ]);

  await sincronizar();

  const sessoes = chamadas.filter(c => c.tabela === 'sessoes_inventario');
  assert.equal(sessoes.length, 1);
  const sessao = sessoes[0].linhas[0];
  assert.match(sessao.id, UUID);
  assert.equal(sessao.cracha_importacao, '123');
  assert.equal(sessao.data_importacao, new Date(1700000000000).toISOString());

  const envio = chamadas.find(c => c.tabela === 'bobinas_lidas');
  assert.deepEqual(envio.opcoes, { onConflict: 'id', ignoreDuplicates: true });
  for (const linha of envio.linhas) {
    assert.equal(linha.sessao_id, sessao.id);
    assert.match(linha.id, UUID);
    assert.equal(linha.data_leitura, new Date(1700000000000).toISOString(), 'data da bipagem, não do envio');
    assert.ok(!('_status' in linha) && !('_criado_em' in linha) && !('uuid' in linha));
  }
  assert.equal(await db.leituras_pendentes.where('_status').equals('sincronizado').count(), 2);
});

test('sessão criada no aparelho é enviada antes das leituras', async () => {
  const id = await registrarSessaoLocal('456');
  await db.leituras_pendentes.add(leitura('VA333333', { sessao_id: id, cracha_leitura: '456' }));

  await sincronizar();

  assert.deepEqual(chamadas.map(c => c.tabela), ['sessoes_inventario', 'bobinas_lidas']);
  assert.equal(await db.sessoes_pendentes.count(), 0);
});

test('erro de dados isola só a leitura problemática e não trava a fila', async () => {
  await db.leituras_pendentes.bulkAdd([leitura('VA111111'), leitura('RUIM'), leitura('VA222222')]);
  responder = (tabela, linhas) => (linhas.some(l => l.lote === 'RUIM')
    ? { error: { code: '23503', message: 'violates foreign key constraint' } }
    : { error: null });

  await sincronizar();

  const porLote = Object.fromEntries((await db.leituras_pendentes.toArray()).map(r => [r.lote, r]));
  assert.equal(porLote.VA111111._status, 'sincronizado');
  assert.equal(porLote.VA222222._status, 'sincronizado');
  assert.equal(porLote.RUIM._status, 'erro');
  assert.match(porLote.RUIM._erro, /23503/);
});

test('falha de rede mantém tudo pendente, e o reenvio usa os mesmos ids (sem duplicar)', async () => {
  await db.leituras_pendentes.bulkAdd([leitura('VA111111'), leitura('VA222222')]);
  responder = () => ({ error: erroDeRede });

  await sincronizar();
  assert.equal(await db.leituras_pendentes.where('_status').equals('pendente').count(), 2);
  const idsPrimeiraTentativa = chamadas.at(-1).linhas.map(l => l.id).sort();

  responder = () => ({ error: null });
  await sincronizar();
  const idsSegundaTentativa = chamadas.at(-1).linhas.map(l => l.id).sort();

  assert.deepEqual(idsSegundaTentativa, idsPrimeiraTentativa);
  assert.equal(await db.leituras_pendentes.where('_status').equals('sincronizado').count(), 2);
});

test('sem rede (navigator.onLine = false) nada é enviado', async () => {
  await db.leituras_pendentes.add(leitura('VA111111'));
  Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });
  try {
    await sincronizar();
  } finally {
    Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
  }
  assert.equal(chamadas.length, 0);
  assert.equal(await db.leituras_pendentes.where('_status').equals('pendente').count(), 1);
});
