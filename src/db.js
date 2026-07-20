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

export default db;
