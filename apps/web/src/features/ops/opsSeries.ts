import { PUBLIC_METRICS, type InstanceMetrics, type OpsSnapshot } from '@electoral/shared';

/** Aggregates of one OpsSnapshot (sum or worst across instances). */
export interface OpsPoint {
  ts: number;
  messagesPerSecond: number;
  eventLoopP99: number;
  actasPerMinute: number;
  latencyP99: number;
  reconnectionsPerSecond: number;
}

const sum = (instances: InstanceMetrics[], read: (i: InstanceMetrics) => number) =>
  instances.reduce((total, instance) => total + (read(instance) || 0), 0);
const worst = (instances: InstanceMetrics[], read: (i: InstanceMetrics) => number) =>
  instances.reduce((max, instance) => Math.max(max, read(instance) || 0), 0);

export function toPoint({ ts, instances }: OpsSnapshot): OpsPoint {
  return {
    ts,
    messagesPerSecond: sum(instances, (i) => i.counters[PUBLIC_METRICS.messagesSent]?.perSecond ?? 0),
    eventLoopP99: worst(instances, (i) => i.eventLoopMs.p99),
    actasPerMinute: sum(instances, (i) => (i.counters[PUBLIC_METRICS.actasRegistered]?.perSecond ?? 0) * 60),
    latencyP99: worst(instances, (i) => i.histograms[PUBLIC_METRICS.publishLatencyMs]?.p99 ?? 0),
    reconnectionsPerSecond: sum(instances, (i) => i.counters[PUBLIC_METRICS.reconnections]?.perSecond ?? 0),
  };
}

/** Real vs naive messages (RF-4) and the reduction factor. */
export function messageTotals(instances: InstanceMetrics[]) {
  const real = sum(instances, (i) => i.counters[PUBLIC_METRICS.messagesSent]?.total ?? 0);
  const naive = sum(instances, (i) => i.counters[PUBLIC_METRICS.messagesNaive]?.total ?? 0);
  return { real, naive, factor: real > 0 ? naive / real : 0 };
}

export const inpP75 = (instances: InstanceMetrics[]) => worst(instances, (i) => i.gauges[PUBLIC_METRICS.inpP75] ?? 0);

/** Keeps the last `size` points (5 min at one point every 2 s). */
export function appendPoint(points: OpsPoint[], point: OpsPoint, size = 150): OpsPoint[] {
  const next = points.length >= size ? points.slice(points.length - size + 1) : [...points];
  next.push(point);
  return next;
}
