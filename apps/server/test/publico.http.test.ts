/** End to end over a real socket: GET /api/publico/stream, snapshot, vitals. */
import { get, request as httpRequest, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/core/config';
import { InMemoryMetrics } from '../src/core/metrics';
import { createBlockingRedis, createRedis } from '../src/core/redis';
import { buildSubmission, createService, createTestRedis, jurorFor, newIdempotencyKey, REDIS_TEST_URL, TEST_CATALOG } from './helpers';
import { parseFrame, type ParsedFrame } from './publico.helpers';

describe('public HTTP/SSE contract', () => {
  let app: FastifyInstance;
  let redis: Redis;
  let seed: Redis;
  let base: string;

  beforeAll(async () => {
    seed = await createTestRedis();
    redis = createRedis(REDIS_TEST_URL);
    await new Promise((resolve) => redis.once('ready', resolve));
    const config = loadConfig({ ...process.env, REDIS_URL: REDIS_TEST_URL, INSTANCE_ID: 'app7', LOG_LEVEL: 'silent', WINDOW_MS: '100' });
    app = await buildApp({
      config,
      redis,
      createBlockingRedis: () => createBlockingRedis(REDIS_TEST_URL),
      supabase: null,
      metrics: new InMemoryMetrics(),
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
    redis.disconnect();
    seed.disconnect();
  });

  /** Opens an SSE stream and collects parsed frames. */
  function openStream(path: string) {
    const frames: ParsedFrame[] = [];
    let response!: IncomingMessage;
    let buffer = '';
    const ready = new Promise<void>((resolve) => {
      const req = get(`${base}${path}`, (res) => {
        response = res;
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const frame = parseFrame(buffer.slice(0, end + 1));
            buffer = buffer.slice(end + 2);
            if (frame) frames.push(frame);
          }
        });
        resolve();
      });
      closers.push(() => req.destroy());
    });
    return { frames, ready, response: () => response };
  }
  const closers: (() => void)[] = [];
  afterAll(() => closers.forEach((close) => close()));

  const waitFor = async (check: () => boolean, ms = 3_000) => {
    const limit = Date.now() + ms;
    while (!check()) {
      if (Date.now() > limit) throw new Error('timeout');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  it('streams a snapshot, then live deltas, with SSE headers and X-Instance', async () => {
    const mun = TEST_CATALOG.municipalities[0]!.id;
    const stream = openStream(`/api/publico/stream?topics=dep,mun:${mun}`);
    await stream.ready;
    expect(stream.response().headers['content-type']).toContain('text/event-stream');
    expect(stream.response().headers['x-instance']).toBe('app7');
    await waitFor(() => stream.frames.filter((f) => f.event === 'snapshot').length === 2);

    const table = TEST_CATALOG.tables.find((t) => TEST_CATALOG.stations.find((s) => s.id === t.stationId)?.municipalityId === mun)!;
    await createService(seed).service.submit({
      submission: buildSubmission(table),
      idempotencyKey: newIdempotencyKey(),
      juror: jurorFor(table),
    });
    await waitFor(() => stream.frames.some((f) => f.event === 'delta'));
    const deltas = stream.frames.filter((f) => f.event === 'delta');
    expect(deltas.map((d) => (d.data as { topic: string }).topic).sort()).toEqual(['dep', `mun:${mun}`]);
    expect(new Set(deltas.map((d) => d.id)).size).toBe(1); // same window id for every topic
  });

  it('rejects bad topic lists and serves the snapshot as JSON', async () => {
    for (const query of ['', '?topics=dep,mun:1,mun:2,mun:3', '?topics=mesa:1']) {
      const response = await app.inject({ method: 'GET', url: `/api/publico/stream${query}` });
      expect(response.statusCode).toBe(400);
    }
    const response = await app.inject({ method: 'GET', url: '/api/publico/snapshot?topic=dep' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ topic: 'dep', tables: { total: TEST_CATALOG.tables.length } });
  });

  it('stores INP samples sent with sendBeacon (text/plain body)', async () => {
    const status = await new Promise<number>((resolve) => {
      const req = httpRequest(`${base}/api/vitals`, { method: 'POST', headers: { 'Content-Type': 'text/plain' } }, (res) =>
        resolve(res.statusCode ?? 0),
      );
      req.end(JSON.stringify({ name: 'INP', value: 120 }));
    });
    expect(status).toBe(204);
    expect(await seed.lrange('vitals:inp', 0, -1)).toContain('120');
  });
});
