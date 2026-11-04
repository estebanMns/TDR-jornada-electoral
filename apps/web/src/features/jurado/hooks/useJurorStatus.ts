import { useCallback, useEffect, useRef, useState } from 'react';
import type { JurorActaState } from '@electoral/shared';
import { getSession } from '../../../app/session';
import { fetchMine } from '../api/actasApi';

const POLL_INTERVAL_MS = 15_000;

/**
 * Server-side state of the juror's actas (UNDER_REVIEW → APPLIED / REJECTED).
 * Polls every 15 s with If-None-Match, so an unchanged state costs a 304.
 * Paused while the tab is hidden.
 */
export function useJurorStatus() {
  const [actas, setActas] = useState<JurorActaState[] | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const etag = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const token = getSession()?.token;
    if (!token || document.visibilityState === 'hidden' || !navigator.onLine) return;
    try {
      const outcome = await fetchMine(token, etag.current);
      if (outcome.kind === 'changed') {
        etag.current = outcome.etag;
        setActas(outcome.actas);
      }
      setLastCheckedAt(Date.now());
    } catch {
      // Network trouble: the next tick tries again.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [refresh]);

  return { actas, lastCheckedAt, refresh };
}
