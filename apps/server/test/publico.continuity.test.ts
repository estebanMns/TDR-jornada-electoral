/**
 * RF-6 continuity, against real Redis and REAL events from the actas module:
 * a client that disconnects and comes back with its id ends up exactly like a
 * client that never left; an unknown id gets a snapshot and also converges.
 */
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TopicId } from '@electoral/shared';
import { createRandom } from '../../../scripts/catalog/random';
import { buildSubmission, createService, createTestRedis, jurorFor, newIdempotencyKey, TEST_CATALOG } from './helpers';
import {
  clientState,
  createPublicService,
  FakeConnection,
  lastId,
  readTopicTotals,
  type TestPublicService,
} from './publico.helpers';

const municipality = TEST_CATALOG.municipalities[0]!;
const TOPICS: TopicId[] = ['dep', `mun:${municipality.id}`];

describe('public stream continuity (RF-6)', () => {
  let redis: Redis;
  let publico: TestPublicService;
  const actas = () => createService(redis).service;
  let tableIndex = 0;

  async function submitActas(count: number, options: { doubtful?: boolean } = {}) {
    const service = actas();
    for (let i = 0; i < count; i++) {
      const table = TEST_CATALOG.tables[tableIndex++ % TEST_CATALOG.tables.length]!;
      await service.submit({
        submission: buildSubmission(table, { random: createRandom(tableIndex), ...options }),
        idempotencyKey: newIdempotencyKey(),
        juror: jurorFor(table),
      });
    }
  }

  /** Lets the reader consume ev:all and closes the window (what the timer does every WINDOW_MS). */
  async function closeWindow() {
    await publico.caughtUpWithStream();
    await publico.service.flushWindow();
  }

  beforeAll(async () => {
    redis = await createTestRedis();
    publico = await createPublicService(redis);
  });

  afterAll(async () => {
    await publico.service.stop();
    redis.disconnect();
  });

  it('a client that reconnects with its id converges to the client that never left', async () => {
    const alwaysOn = new FakeConnection();
    const reconnecting = new FakeConnection();
    await publico.service.open(alwaysOn, TOPICS, null);
    await publico.service.open(reconnecting, TOPICS, null);
    expect(alwaysOn.messages()[0]?.event).toBe('snapshot');

    await submitActas(8);
    await closeWindow();

    // B goes away (network lost) while results keep arriving…
    const resumeFrom = lastId(reconnecting)!;
    reconnecting.close('network');
    await submitActas(12);
    await closeWindow();
    await submitActas(6, { doubtful: true }); // reversals / under review
    await closeWindow();

    // …and comes back with its last id on a NEW connection (maybe another instance).
    const back = new FakeConnection();
    await publico.service.open(back, TOPICS, resumeFrom);
    expect(back.messages().map((m) => m.event)).toEqual(['delta', 'delta']); // one merged delta per topic, no snapshot

    await submitActas(5);
    await closeWindow();

    const truth = await readTopicTotals(redis, TOPICS);
    const continuous = clientState(alwaysOn);
    const resumed = clientState(Object.assign(new FakeConnection(), { frames: [...reconnecting.frames, ...back.frames] }));
    expect(continuous).toEqual(truth);
    expect(resumed).toEqual(continuous);
  });

  it('an unknown or trimmed id gets a snapshot and converges as well', async () => {
    const stranger = new FakeConnection();
    await publico.service.open(stranger, TOPICS, '1-0');
    expect(stranger.messages().map((m) => m.event)).toEqual(['snapshot', 'snapshot']);
    expect(clientState(stranger)).toEqual(await readTopicTotals(redis, TOPICS));
  });

  it('counts real messages vs the naive design (every event to every connection)', async () => {
    const sent = publico.metrics.counters.get('sse_messages_sent') ?? 0;
    const naive = publico.metrics.counters.get('sse_messages_naive') ?? 0;
    expect(sent).toBeGreaterThan(0);
    expect(naive).toBeGreaterThan(sent);
  });
});
