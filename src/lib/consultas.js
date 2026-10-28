// src/lib/consultas.js — Consultas ao Supabase sem truncamento silencioso.
//
// O PostgREST devolve no máximo "Max Rows" linhas por requisição (neste projeto: 10.000),
// ignorando .limit() maiores. Toda leitura de tabela que cresce precisa paginar.
import { supabase } from '../supabase.js';
import { gerarUuid, sinalTimeout } from '../sync.js';

const TAMANHO_PAGINA = 1000;

/**
 * Busca todas as linhas paginando com .range().
 * `montarQuery` deve devolver um builder NOVO a cada chamada, com ordenação estável (ex.: por id).
 */
export async function buscarTodasPaginas(montarQuery, tamanhoPagina = TAMANHO_PAGINA) {
  const todas = [];
  for (let inicio = 0; ; inicio += tamanhoPagina) {
    const { data, error } = await montarQuery().range(inicio, inicio + tamanhoPagina - 1);
    if (error) throw error;
    todas.push(...(data || []));
    if (!data || data.length < tamanhoPagina) return todas;
  }
}

/**
 * Busca linhas filtrando por uma lista de valores (`.in(...)`), quebrando a lista em lotes
 * para não estourar o tamanho da URL. `montarQuery(loteDeValores)` devolve o builder já filtrado.
 */
export async function buscarPorValores(montarQuery, valores, { tamanhoLote = 150, paralelo = 4 } = {}) {
  const unicos = [...new Set(valores.filter(v => v !== null && v !== undefined && v !== ''))];
  const lotes = [];
  for (let i = 0; i < unicos.length; i += tamanhoLote) lotes.push(unicos.slice(i, i + tamanhoLote));

  const resultado = [];
  for (let i = 0; i < lotes.length; i += paralelo) {
    const respostas = await Promise.all(
      lotes.slice(i, i + paralelo).map(lote => buscarTodasPaginas(() => montarQuery(lote)))
    );
    respostas.forEach(linhas => resultado.push(...linhas));
  }
  return resultado;
}

// Colunas que o app envia mas que ainda podem não existir em `bobinas_sap`
// (ver supabase/migrations/001_bobinas_sap_romaneio_agrupador.sql).
const COLUNAS_OPCIONAIS_SAP = ['romaneio', 'agrupador'];

/**
 * Grava a base SAP importada em lotes. Cada linha recebe um uuid gerado aqui, então uma nova
 * tentativa após queda de rede não duplica registros. Se o banco ainda não tiver alguma coluna
 * opcional, ela é descartada e a gravação continua (em vez de perder a planilha inteira).
 *
 * @returns {{ salvas: number, total: number, error: object|null, colunasIgnoradas: string[] }}
 */
export async function salvarBaseSap(linhas, { tamanhoLote = 500 } = {}) {
  const comId = linhas.map(l => ({ id: gerarUuid(), ...l }));
  const colunasIgnoradas = new Set();
  let salvas = 0;

  for (let i = 0; i < comId.length; i += tamanhoLote) {
    const lote = comId.slice(i, i + tamanhoLote);
    for (;;) {
      const payload = lote.map(l => {
        const copia = { ...l };
        colunasIgnoradas.forEach(c => delete copia[c]);
        return copia;
      });
      const { error } = await supabase
        .from('bobinas_sap')
        .upsert(payload, { onConflict: 'id', ignoreDuplicates: true })
        .abortSignal(sinalTimeout(30000));
      if (!error) {
        salvas += lote.length;
        break;
      }
      const colunaFaltando = error.code === 'PGRST204' ? /'([^']+)' column/.exec(error.message || '')?.[1] : null;
      if (colunaFaltando && COLUNAS_OPCIONAIS_SAP.includes(colunaFaltando) && !colunasIgnoradas.has(colunaFaltando)) {
        colunasIgnoradas.add(colunaFaltando);
        continue;
      }
      return { salvas, total: linhas.length, error, colunasIgnoradas: [...colunasIgnoradas] };
    }
  }
  return { salvas, total: linhas.length, error: null, colunasIgnoradas: [...colunasIgnoradas] };
}
