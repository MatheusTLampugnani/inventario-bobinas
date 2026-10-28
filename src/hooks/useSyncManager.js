// src/hooks/useSyncManager.js
// Hook de Sincronização Offline-First.
// Monitora a conectividade de rede e sincroniza automaticamente
// as leituras pendentes no IndexedDB com o Supabase (ver src/sync.js).
import { useState, useEffect, useCallback } from 'react';
import db from '../db';
import { sincronizar } from '../sync';

const INTERVALO_RETENTATIVA_MS = 30000;

/**
 * useSyncManager
 *
 * @returns {object} { isOnline, pendingCount, errorCount, syncNow, reenviarComErro }
 *   - isOnline: boolean — true se o navegador detecta conexão de rede
 *   - pendingCount: number — leituras na fila aguardando sincronização
 *   - errorCount: number — leituras recusadas pelo servidor (não bloqueiam a fila)
 *   - syncNow: async function — dispara uma sincronização imediata (chamada após cada bipagem)
 *   - reenviarComErro: async function — devolve as leituras com erro para a fila e sincroniza
 */
export function useSyncManager() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);

  const refreshPendingCount = useCallback(async () => {
    const [pendentes, comErro] = await Promise.all([
      db.leituras_pendentes.where('_status').equals('pendente').count(),
      db.leituras_pendentes.where('_status').equals('erro').count(),
    ]);
    setPendingCount(pendentes);
    setErrorCount(comErro);
  }, []);

  const syncNow = useCallback(async () => {
    try {
      if (navigator.onLine) await sincronizar();
    } finally {
      await refreshPendingCount();
    }
  }, [refreshPendingCount]);

  const reenviarComErro = useCallback(async () => {
    await db.leituras_pendentes.where('_status').equals('erro').modify({ _status: 'pendente', _erro: undefined });
    await syncNow();
  }, [syncNow]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      syncNow();
    };
    const handleOffline = () => {
      setIsOnline(false);
      refreshPendingCount();
    };
    // Celular volta do bolso / app volta para frente: tenta enviar o que ficou na fila
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') syncNow();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);

    // Retentativa periódica: navigator.onLine pode ser true com Wi-Fi sem internet,
    // então uma falha não pode depender só do evento 'online' para ser retomada.
    const intervalo = setInterval(() => {
      if (navigator.onLine) syncNow();
    }, INTERVALO_RETENTATIVA_MS);

    // Captura pendências de sessões anteriores logo ao abrir o app
    syncNow();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
      clearInterval(intervalo);
    };
  }, [syncNow, refreshPendingCount]);

  return { isOnline, pendingCount, errorCount, syncNow, reenviarComErro };
}
