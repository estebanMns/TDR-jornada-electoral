import { useCallback } from 'react';
import { Badge, Card, PageShell, Stat, StatusDot } from '../../shared/ui';
import { InstanceCard } from './components/InstanceCard';
import { TimeSeriesChart } from './components/TimeSeriesChart';
import { inpP75, messageTotals, type OpsPoint } from './opsSeries';
import { useOpsStream } from './useOpsStream';

/** A report older than this means the instance stopped publishing (down). */
const STALE_MS = 6_000;

const CHARTS: { title: string; unit: string; color: string; read: (p: OpsPoint) => number }[] = [
  { title: 'Mensajes enviados/s', unit: 'msg/s', color: '#2563eb', read: (p) => p.messagesPerSecond },
  { title: 'Retraso del Event Loop p99 (peor instancia)', unit: 'ms', color: '#dc2626', read: (p) => p.eventLoopP99 },
  { title: 'Actas registradas/min', unit: 'actas/min', color: '#16a34a', read: (p) => p.actasPerMinute },
  { title: 'Latencia recepción → publicación p99', unit: 'ms', color: '#9333ea', read: (p) => p.latencyP99 },
  { title: 'Reconexiones/s', unit: 'rec/s', color: '#ea580c', read: (p) => p.reconnectionsPerSecond },
];

/** `/ops` (ADMIN): RT-7 dashboard. Data: Meneses' `GET /api/ops/stream`. */
export default function OpsDashboard() {
  const { latest, points, connection, redisDown } = useOpsStream();
  const instances = latest?.instances ?? [];
  const totals = messageTotals(instances);
  const connections = instances.reduce((n, i) => n + i.connections.sse + i.connections.ws, 0);
  const status = redisDown ? 'paused' : connection === 'open' ? 'live' : connection === 'connecting' ? 'connecting' : 'reconnecting';
  const now = latest?.ts ?? 0;
  const reader = useCallback((read: (p: OpsPoint) => number) => read, []);

  return (
    <PageShell title="Operación" subtitle={`${instances.length} instancias reportando`} actions={<StatusDot status={status} />}>
      {redisDown && (
        <p role="status" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          Redis no responde: las métricas se reanudan cuando vuelva.
        </p>
      )}

      <Card className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Conexiones totales" value={connections.toLocaleString('es-CO')} />
        <Stat
          label="Mensajes reales vs ingenuos"
          value={totals.factor > 0 ? `×${totals.factor.toFixed(0)} menos` : '—'}
          hint={`${Math.round(totals.real).toLocaleString('es-CO')} reales · ${Math.round(totals.naive).toLocaleString('es-CO')} ingenuos`}
        />
        <Stat label="INP p75 (/resultados)" value={`${inpP75(instances).toFixed(0)} ms`} hint="Meta: ≤ 200 ms" />
        <Stat
          label="Instancias"
          value={instances.length}
          hint={<Badge tone={instances.length >= 8 ? 'success' : 'warning'}>{instances.length >= 8 ? 'Completas' : 'Faltan instancias'}</Badge>}
        />
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {CHARTS.map((chart) => (
          <Card key={chart.title}>
            <TimeSeriesChart title={chart.title} unit={chart.unit} color={chart.color} points={points} read={reader(chart.read)} />
          </Card>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {instances.map((metrics) => (
          <InstanceCard key={metrics.instance} metrics={metrics} stale={now - metrics.ts > STALE_MS} />
        ))}
      </div>
    </PageShell>
  );
}
