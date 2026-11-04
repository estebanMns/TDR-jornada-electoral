import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { SSE_EVENTS, type PublicDelta, type PublicSnapshot, type PublicStatus, type TopicId } from '@electoral/shared';
import { backoffDelay } from '../../../shared/net/backoff';
import { SseClient } from '../../../shared/net/sse';
import { ResultsStore } from './resultsStore';

/**
 * First reconnection window of the PUBLIC page: 5 s instead of 500 ms.
 * Measured with loadtest/avalancha.ts (4.000 clients dropped at once): peak of
 * 1.024 reconnections/100 ms with base 500 ms vs 163 with base 5 s (and half the
 * attempts). Waiting ~2.5 s on average is unnoticeable on a results page.
 */
const PUBLIC_BACKOFF_BASE_MS = 5_000;

/** One SSE connection for the topics on screen; reconnects with backoff and resumes by id. */
export function usePublicResults(topics: readonly TopicId[]) {
  const key = topics.join(',');
  const store = useMemo(() => new ResultsStore(), [key]);

  useEffect(() => {
    const client = new SseClient({
      url: (lastEventId) =>
        `/api/publico/stream?topics=${encodeURIComponent(key)}${lastEventId ? `&lastEventId=${encodeURIComponent(lastEventId)}` : ''}`,
      handlers: {
        [SSE_EVENTS.snapshot]: (data) => store.applySnapshot(data as PublicSnapshot),
        [SSE_EVENTS.delta]: (data, id) => store.applyDelta(data as PublicDelta, id),
        [SSE_EVENTS.status]: (data) => store.applyStatus(data as PublicStatus),
      },
      reconnectEvent: SSE_EVENTS.reconnect,
      onState: (state) => store.setConnected(state === 'open'),
      delay: (attempt) => backoffDelay(attempt, { baseMs: PUBLIC_BACKOFF_BASE_MS }),
    });
    client.start();
    return () => client.stop();
  }, [key, store]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
