// src/hooks/useSyncManager.js
// Hook de Sincronização Offline-First.
// Monitora a conectividade de rede e sincroniza automaticamente
// as leituras pendentes no IndexedDB com o Supabase quando a conexão é restaurada.
import { useState, useEffect, useCallback, useRef } from 'react';
import db from '../db';
import { supabase } from '../supabase';

/**
 * useSyncManager
 *
 * @returns {object} { isOnline, pendingCount, syncNow }
 *   - isOnline: boolean — true se o navegador detecta conexão de rede
 *   - pendingCount: number — número de leituras na fila aguardando sincronização
 *   - syncNow: async function — dispara uma sincronização imediata (chamada após cada bipagem)
 */
export function useSyncManager() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  // Ref para evitar sincronizações simultâneas
  const isSyncing = useRef(false);

  // Atualiza o contador de pendências a partir do IndexedDB
  const refreshPendingCount = useCallback(async () => {
    const count = await db.leituras_pendentes.where('_status').equals('pendente').count();
    setPendingCount(count);
  }, []);

  // Sincroniza todas as leituras pendentes com o Supabase
  const syncNow = useCallback(async () => {
    if (isSyncing.current || !navigator.onLine) {
      await refreshPendingCount();
      return;
    }

    isSyncing.current = true;

    try {
      const pendentes = await db.leituras_pendentes
        .where('_status').equals('pendente')
        .sortBy('_criado_em');

      if (pendentes.length === 0) {
        await refreshPendingCount();
        return;
      }

      // Prepara o payload — remove os campos internos do Dexie antes de enviar ao Supabase
      const payload = pendentes.map(({ id, _status, _criado_em, ...dado }) => dado);

      const { error } = await supabase.from('bobinas_lidas').insert(payload);

      if (error) {
        // Não altera o status para não reprocessar em loop em caso de erro de schema
        console.error('[SyncManager] Erro ao sincronizar com Supabase:', error);
      } else {
        // Marca todas como sincronizadas
        const ids = pendentes.map(p => p.id);
        await db.leituras_pendentes
          .where('id').anyOf(ids)
          .modify({ _status: 'sincronizado' });

        console.log(`[SyncManager] ${pendentes.length} leitura(s) sincronizada(s) com sucesso.`);
      }
    } catch (err) {
      console.error('[SyncManager] Erro inesperado na sincronização:', err);
    } finally {
      isSyncing.current = false;
      await refreshPendingCount();
    }
  }, [refreshPendingCount]);

  // Listener de conectividade — sincroniza automaticamente ao voltar online
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      syncNow();
    };
    const handleOffline = () => {
      setIsOnline(false);
      refreshPendingCount();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Verifica pendências ao montar o componente
    refreshPendingCount();

    // Tenta sincronizar no início da sessão (captura falhas anteriores)
    if (navigator.onLine) syncNow();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncNow, refreshPendingCount]);

  return { isOnline, pendingCount, syncNow };
}
