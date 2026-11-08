import { useCallback, useEffect, useRef, useState } from 'react';
import { handleLoadError } from './asyncError';

/**
 * Petit hook de chargement de données async.
 * Usage : const { data, loading, refreshing, error, refresh } = useAsync(() => patientApi.getDoctors(), []);
 * - `loading`    : premier chargement.
 * - `refreshing` : rechargement via pull-to-refresh (`refresh()`).
 * - `refresh()`  : promesse à brancher sur <RefreshControl onRefresh={refresh} />.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // Garde la dernière version de fn sans la mettre dans les deps de l'effet.
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fnRef
      .current()
      .then((res) => active && setData(res))
      .catch((e) => {
        // Signaler même si l'écran est démonté : la session expirée concerne toute l'application.
        const message = handleLoadError(e);
        if (active) setError(message);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fnRef.current();
      setData(res);
    } catch (e) {
      setError(handleLoadError(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return {
    data,
    loading,
    refreshing,
    error,
    refresh,
    reload,
  };
}
