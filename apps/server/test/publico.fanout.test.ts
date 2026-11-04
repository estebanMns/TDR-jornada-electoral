/**
 * RF-4 fan-out: 50.000 in-memory connections and a burst of windows. Sending
 * in batches that yield to the event loop keeps its delay low; sending
 * everything at once blocks it. Both numbers are printed for the report.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import type { AccumulatedEvent, TopicId } from '@electoral/shared';
import { InMemoryMetrics } from '../src/core/metrics';
import { ThresholdBackpressurePolicy } from '../src/modules/publico/backpressure';
import { Broadcaster } from '../src/modules/publico/broadcaster';
import { createSubscriber, type PublicSubscriber } from '../src/modules/publico/subscriber';
import { TopicRegistry } from '../src/modules/publico/topicRegistry';
import { WindowAggregator } from '../src/modules/publico/windowAggregator';
import { FakeConnection } from './publico.helpers';

const CONNECTIONS = 50_000;

/** Topic mix of the load test: 60 % dep, 35 % municipality, 5 % station. */
function topicFor(i: number): TopicId {
  const r = i % 100;
  if (r < 60) return 'dep';
  if (r < 95) return `mun:${(i % 30) + 1}`;
  return `station:${(i % 1_842) + 1}`;
}

function event(n: number): AccumulatedEvent {
  const mun = (n % 30) + 1;
  const station = (n % 1_842) + 1;
  const values = { C1: 1_000 + n, C2: 900 + n, _reported: n };
  return {
    id: `${1_000 + n}-0`,
    acta: `E14-${station}-0001-03`,
    version: 1,
    type: 'APPLIED',
    reason: 'FIRST_REPORT',
    tsRx: Date.now(),
    table: n,
    station,
    mun,
    abs: { dep: values, [`mun:${mun}`]: values, [`station:${station}`]: values },
  };
}

async function measure(batchSize: number) {
  const registry = new TopicRegistry<PublicSubscriber>();
  for (let i = 0; i < CONNECTIONS; i++) {
    const subscriber = createSubscriber(new FakeConnection(), [topicFor(i)]);
    subscriber.catchingUp = false;
    registry.add(topicFor(i), subscriber);
  }
  const broadcaster = new Broadcaster({
    registry,
    policy: new ThresholdBackpressurePolicy(),
    metrics: new InMemoryMetrics(),
    connectionCount: () => CONNECTIONS,
    onLagging: () => {},
    batchSize,
  });

  const histogram = monitorEventLoopDelay({ resolution: 1 });
  histogram.enable();
  // A timer keeps ticking during the burst: if the fan-out blocks, its delay grows.
  const ticker = setInterval(() => {}, 1);
  let sent = 0;
  let naive = 0;
  for (let w = 0; w < 10; w++) {
    const aggregator = new WindowAggregator();
    for (let e = 0; e < 40; e++) aggregator.add(event(w * 40 + e)); // ~20 events/s burst in a 2 s window
    const result = await broadcaster.publish(aggregator.drain()!);
    sent += result.sent;
    naive += result.naive;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  clearInterval(ticker);
  histogram.disable();
  return { p99Ms: histogram.percentile(99) / 1e6, maxMs: histogram.max / 1e6, sent, naive };
}

describe('fan-out with 50.000 connections (RF-4)', () => {
  it('batches of 500 keep the event loop responsive; one big loop does not', async () => {
    const batched = await measure(500);
    const unbatched = await measure(Number.MAX_SAFE_INTEGER);

    console.table({
      'por lotes (500)': { 'p99 ms': batched.p99Ms.toFixed(1), 'max ms': batched.maxMs.toFixed(1) },
      'sin lotes': { 'p99 ms': unbatched.p99Ms.toFixed(1), 'max ms': unbatched.maxMs.toFixed(1) },
    });
    console.log(
      `mensajes reales ${batched.sent.toLocaleString('es')} vs ingenuos ${batched.naive.toLocaleString('es')} ` +
        `(reducción ×${(batched.naive / batched.sent).toFixed(0)})`,
    );

    expect(batched.p99Ms).toBeLessThan(50);
    expect(batched.maxMs).toBeLessThan(unbatched.maxMs);
    // Each subscriber gets one message per window for its topic, not one per event.
    expect(batched.sent).toBeLessThan(batched.naive / 10);
  });
});
