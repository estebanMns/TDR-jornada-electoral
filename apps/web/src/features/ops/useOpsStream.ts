import { useEffect, useState } from 'react';
import type { OpsSnapshot } from '@electoral/shared';
import { getSession } from '../../app/session';
import { SseClient, type SseState } from '../../shared/net/sse';
import { appendPoint, toPoint, type OpsPoint } from './opsSeries';

/**
 * `GET /api/ops/stream` (Meneses). EventSource cannot send an Authorization
 * header, so the ADMIN token travels in `?token=`.
 */
export function useOpsStream() {
  const [latest, setLatest] = useState<OpsSnapshot | null>(null);
  const [points, setPoints] = useState<OpsPoint[]>([]);
  const [connection, setConnection] = useState<SseState>('connecting');
  const [redisDown, setRedisDown] = useState(false);

  useEffect(() => {
    const token = getSession()?.token ?? '';
    const client = new SseClient({
      url: () => `/api/ops/stream?token=${encodeURIComponent(token)}`,
      handlers: {
        metrics: (data) => {
          const snapshot = data as OpsSnapshot;
          setRedisDown(false);
          setLatest(snapshot);
          setPoints((previous) => appendPoint(previous, toPoint(snapshot)));
        },
        status: (data) => setRedisDown((data as { redis?: string }).redis === 'degraded'),
      },
      onState: setConnection,
    });
    client.start();
    return () => client.stop();
  }, []);

  return { latest, points, connection, redisDown };
}
