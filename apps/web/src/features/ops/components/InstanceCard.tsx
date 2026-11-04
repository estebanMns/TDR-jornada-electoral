import { PUBLIC_METRICS, type InstanceMetrics } from '@electoral/shared';
import { Badge, Card } from '../../../shared/ui';

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

/** One card per instance: connections, messages/s, event loop, memory per connection, Redis. */
export function InstanceCard({ metrics, stale }: { metrics: InstanceMetrics; stale: boolean }) {
  const connections = metrics.connections.sse + metrics.connections.ws;
  const loop = metrics.eventLoopMs;
  return (
    <Card className={stale ? 'opacity-50' : undefined}>
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-lg font-semibold">{metrics.instance}</h3>
        <Badge tone={metrics.redis === 'ok' ? 'success' : 'danger'}>Redis {metrics.redis === 'ok' ? 'ok' : 'degradado'}</Badge>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-ink-soft">SSE / WS</dt>
        <dd className="text-right tabular-nums">
          {metrics.connections.sse.toLocaleString('es-CO')} / {metrics.connections.ws.toLocaleString('es-CO')}
        </dd>
        <dt className="text-ink-soft">Mensajes/s</dt>
        <dd className="text-right tabular-nums">{(metrics.counters[PUBLIC_METRICS.messagesSent]?.perSecond ?? 0).toFixed(0)}</dd>
        <dt className="text-ink-soft">Event Loop p50/p99/max</dt>
        <dd className={`text-right tabular-nums ${loop.p99 > 50 ? 'font-semibold text-danger' : ''}`}>
          {loop.p50.toFixed(1)} / {loop.p99.toFixed(1)} / {loop.max.toFixed(0)} ms
        </dd>
        <dt className="text-ink-soft">Memoria por conexión</dt>
        <dd className="text-right tabular-nums">{connections > 0 ? kb(metrics.memory.heapUsed / connections) : '—'}</dd>
        <dt className="text-ink-soft">RSS</dt>
        <dd className="text-right tabular-nums">{(metrics.memory.rss / 1024 / 1024).toFixed(0)} MB</dd>
      </dl>
    </Card>
  );
}
