/**
 * Operations dashboard contract (RT-7). `GET /api/ops/stream` (Meneses) emits
 * `event: metrics` with {@link OpsSnapshot}; the UI (Evelyn) renders it.
 * Additive: new file.
 */

export interface CounterReading {
  total: number;
  perSecond: number;
}

export interface HistogramReading {
  n: number;
  p50: number;
  p99: number;
  max: number;
}

/** One instance report (published every 2 s to `metrics:inst:{id}`). */
export interface InstanceMetrics {
  instance: string;
  ts: number;
  redis: 'ok' | 'degraded';
  connections: { sse: number; ws: number };
  eventLoopMs: { p50: number; p99: number; max: number };
  memory: { rss: number; heapUsed: number };
  counters: Record<string, CounterReading>;
  histograms: Record<string, HistogramReading>;
  gauges: Record<string, number>;
}

export interface OpsSnapshot {
  ts: number;
  instances: InstanceMetrics[];
}

/** Metric names used by the public module (so the dashboard reads the same names). */
export const PUBLIC_METRICS = {
  messagesSent: 'sse_messages_sent',
  messagesNaive: 'sse_messages_naive',
  reconnections: 'sse_reconnections',
  slowDisconnected: 'sse_slow_disconnected',
  laggingClients: 'sse_lagging',
  sseConnections: 'sse_connections',
  publishLatencyMs: 'publish_latency_ms',
  inpP75: 'inp_p75',
  actasRegistered: 'actas_result_registered',
} as const;
