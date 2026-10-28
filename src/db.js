// src/db.js — Instância do Dexie.js (IndexedDB Local)
// Camada de persistência local para o padrão Offline-First.
// Garante que nenhuma bipagem seja perdida em caso de falha de rede.
import Dexie from 'dexie';

const db = new Dexie('InventarioBobinasDB');

/**
 * Schema v1 do banco local.
 *
 * Tabela `leituras_pendentes`:
 *   Fila de sincronização. Toda leitura passa por aqui antes de ir ao Supabase.
 *   Colunas indexadas:
 *     ++id        — chave primária auto-incrementada
 *     _status     — 'pendente' | 'sincronizado' | 'erro'  (para queries de fila)
 *     sessao_id   — para agrupar por sessão
 *     lote        — para evitar duplicatas locais
 *     _criado_em  — timestamp para ordenação cronológica
 */
db.version(1).stores({
  leituras_pendentes: '++id, _status, sessao_id, lote, _criado_em',
});

/**
 * Schema v2:
 *   - `leituras_pendentes.uuid`: id definitivo da leitura no Supabase, gerado no aparelho.
 *     Torna o envio idempotente (reenviar após queda de rede não duplica a leitura).
 *   - `sessoes_pendentes`: sessões criadas no aparelho (id uuid gerado localmente) que ainda
 *     não foram gravadas em `sessoes_inventario`. São enviadas antes das leituras.
 *   - `sessoes_offline`: mapa dos ids antigos `offline-<timestamp>` (versões anteriores) para
 *     o uuid que os substitui, permitindo que essas leituras finalmente sincronizem.
 */
db.version(2).stores({
  leituras_pendentes: '++id, _status, sessao_id, lote, _criado_em, uuid',
  sessoes_pendentes: 'id',
  sessoes_offline: 'offlineId',
});

export default db;
