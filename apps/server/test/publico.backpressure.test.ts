/** RF-9 slow clients and RF-10 paused updates, against real Redis. */
import type { Redis } from 'ioredis';
import { Redis as IORedis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryMetrics } from '../src/core/metrics';
import { createRedis } from '../src/core/redis';
import { ThresholdBackpressurePolicy } from '../src/modules/publico/backpressure';
import { PublicoRepository } from '../src/modules/publico/publico.repository';
import { PublicStreamService } from '../src/modules/publico/publico.service';
import { createRandom } from '../../../scripts/catalog/random';
import { buildSubmission, createService, createTestRedis, jurorFor, newIdempotencyKey, TEST_CATALOG } from './helpers';
import { createPublicService, FakeConnection, type TestPublicService } from './publico.helpers';

describe('slow clients (RF-9)', () => {
  let redis: Redis;
  let publico: TestPublicService;
  let clock = Date.now();
  let n = 0;

  async function newWindow() {
    const table = TEST_CATALOG.tables[n++ % TEST_CATALOG.tables.length]!;
    await createService(redis).service.submit({
      submission: buildSubmission(table, { random: createRandom(500 + n) }),
      idempotencyKey: newIdempotencyKey(),
      juror: jurorFor(table),
    });
    await publico.caughtUpWithStream();
    await publico.service.flushWindow();
  }

  beforeAll(async () => {
    redis = await createTestRedis();
    publico = await createPublicService(redis, { now: () => clock });
  });
  afterAll(async () => {
    await publico.service.stop();
    redis.disconnect();
  });
  afterEach(() => {
    clock = Date.now();
  });

  it('> 64 KB pending: stops getting deltas, and gets a snapshot when it drains', async () => {
    const slow = new FakeConnection();
    await publico.service.open(slow, ['dep'], null);
    slow.buffered = 100 * 1024;
    const before = slow.frames.length;

    await newWindow();
    expect(slow.frames.length).toBe(before); // delta skipped
    expect(publico.metrics.gauges.get('sse_lagging')?.()).toBe(1);

    slow.drain();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(slow.messages().at(-1)?.event).toBe('snapshot');
    expect(publico.metrics.gauges.get('sse_lagging')?.()).toBe(0);

    await newWindow();
    expect(slow.messages().at(-1)?.event).toBe('delta'); // live again
  });

  it('> 512 KB pending: told to reconnect and disconnected (memory stays bounded)', async () => {
    const stuck = new FakeConnection();
    await publico.service.open(stuck, ['dep'], null);
    stuck.buffered = 600 * 1024;
    await newWindow();
    expect(stuck.closedWith).toBe('slow-client');
    expect(publico.metrics.counters.get('sse_slow_disconnected')).toBeGreaterThanOrEqual(1);
  });

  it('lagging for more than 30 s: disconnected', async () => {
    const lagging = new FakeConnection();
    await publico.service.open(lagging, ['dep'], null);
    lagging.buffered = 80 * 1024;
    await newWindow(); // becomes lagging
    expect(lagging.closedWith).toBeNull();
    clock += 31_000;
    await newWindow();
    expect(lagging.closedWith).toBe('slow-client');
  });

  it('the policy is a swappable strategy', () => {
    const policy = new ThresholdBackpressurePolicy({ lagBytes: 10, dropBytes: 20, maxLagMs: 5 });
    const subscriber = { connection: Object.assign(new FakeConnection(), { buffered: 15 }), laggingSince: null } as never;
    expect(policy.decide(subscriber, 0)).toBe('skip');
  });
});

describe('Redis down (RF-10)', () => {
  it('a client that connects while Redis is down is told updates are paused', async () => {
    const dead = createRedis('redis://localhost:6399'); // nothing listens there
    const blocking = new IORedis('redis://localhost:6399', { maxRetriesPerRequest: null, lazyConnect: true });
    dead.on('error', () => {});
    const service = new PublicStreamService({
      redis: dead,
      blockingRedis: blocking,
      repository: new PublicoRepository(dead),
      policy: new ThresholdBackpressurePolicy(),
      metrics: new InMemoryMetrics(),
      windowMs: 60_000,
    });
    await service.start();
    const client = new FakeConnection();
    await service.open(client, ['dep'], null);
    expect(client.messages()).toEqual([{ event: 'status', data: { paused: true, since: expect.any(Number) } }]);
    await service.stop();
    dead.disconnect();
  });
});
