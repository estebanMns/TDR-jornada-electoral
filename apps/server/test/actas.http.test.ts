/** HTTP contract of the actas module, including RF-10 (Redis down → explicit 503). */
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { JwtPayload } from '@preconteo/contracts';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/core/config';
import { InMemoryMetrics } from '../src/core/metrics';
import { createRedis } from '../src/core/redis';
import { buildSubmission, createTestRedis, jurorFor, newIdempotencyKey, REDIS_TEST_URL, TEST_CATALOG } from './helpers';

const table = TEST_CATALOG.tables[0]!;

async function createApp(redisUrl: string): Promise<{ app: FastifyInstance; redis: Redis }> {
  const config = loadConfig({ ...process.env, REDIS_URL: redisUrl, INSTANCE_ID: 'app-test', LOG_LEVEL: 'silent' });
  const redis = createRedis(redisUrl);
  const app = await buildApp({
    config,
    redis,
    createBlockingRedis: () => createRedis(redisUrl),
    supabase: null,
    metrics: new InMemoryMetrics(),
  });
  await app.ready();
  return { app, redis };
}

function tokenFor(app: FastifyInstance, payload: JwtPayload): string {
  return app.jwt.sign(payload);
}

describe('actas HTTP contract', () => {
  let app: FastifyInstance;
  let redis: Redis;
  let seedRedis: Redis;

  beforeAll(async () => {
    seedRedis = await createTestRedis();
    ({ app, redis } = await createApp(REDIS_TEST_URL));
    await new Promise((resolve) => (redis.status === 'ready' ? resolve(null) : redis.once('ready', resolve)));
  });

  afterAll(async () => {
    await app.close();
    redis.disconnect();
    seedRedis.disconnect();
  });

  it('answers 201 REGISTERED and then 200 ALREADY_REGISTERED with the instance header', async () => {
    const request = {
      method: 'POST' as const,
      url: '/api/actas',
      headers: {
        authorization: `Bearer ${tokenFor(app, jurorFor(table))}`,
        'idempotency-key': newIdempotencyKey(),
      },
      payload: buildSubmission(table),
    };
    const first = await app.inject(request);
    expect(first.statusCode).toBe(201);
    expect(first.headers['x-instance']).toBe('app-test');
    expect(first.json()).toMatchObject({ result: 'REGISTERED', instance: 'app-test' });

    const second = await app.inject(request);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ result: 'ALREADY_REGISTERED', replayed: true });
  });

  it('forbids sending the acta of another table', async () => {
    const other = TEST_CATALOG.tables[1]!;
    const response = await app.inject({
      method: 'POST',
      url: '/api/actas',
      headers: { authorization: `Bearer ${tokenFor(app, jurorFor(table))}`, 'idempotency-key': newIdempotencyKey() },
      payload: buildSubmission(other),
    });
    expect(response.statusCode).toBe(403);
  });

  it('accepts the platform login token from the session cookie', async () => {
    const platformToken = app.jwt.sign({ sub: 'uuid-juror', rol: 'JURADO', nombre: 'Jurado', mesa: table.id } as never);
    const response = await app.inject({
      method: 'GET',
      url: '/api/actas/mine',
      headers: { cookie: `other=1; preconteo_sesion=${platformToken}` },
    });
    expect(response.statusCode).toBe(200);
  });

  it('only lets auditors post resolutions', async () => {
    const payload = { actaId: table.actaId, version: 1, decision: 'APPROVE', auditor: 'a1', fencing: 1 };
    const asJuror = await app.inject({
      method: 'POST',
      url: '/api/actas/resolutions',
      headers: { authorization: `Bearer ${tokenFor(app, jurorFor(table))}` },
      payload,
    });
    expect(asJuror.statusCode).toBe(403);

    const auditorToken = app.jwt.sign({ sub: 'a1', rol: 'AUDITOR', nombre: 'Auditor' } as never);
    const asAuditor = await app.inject({
      method: 'POST',
      url: '/api/actas/resolutions',
      headers: { authorization: `Bearer ${auditorToken}` },
      payload,
    });
    // Version 1 of this table was applied (not under review) in the first test.
    expect(asAuditor.statusCode).toBe(200);
    expect(asAuditor.json()).toMatchObject({ result: 'NOT_UNDER_REVIEW' });
  });

  it('serves the juror status with ETag and 304', async () => {
    const authorization = `Bearer ${tokenFor(app, jurorFor(table))}`;
    const first = await app.inject({ method: 'GET', url: '/api/actas/mine', headers: { authorization } });
    expect(first.statusCode).toBe(200);
    expect(first.json().actas[0]).toMatchObject({ actaId: table.actaId, status: 'APPLIED', appliedVersion: 1 });

    const second = await app.inject({
      method: 'GET',
      url: '/api/actas/mine',
      headers: { authorization, 'if-none-match': first.headers.etag as string },
    });
    expect(second.statusCode).toBe(304);
  });
});

describe('RF-10 Redis down', () => {
  let app: FastifyInstance;
  let redis: Redis;

  afterEach(async () => {
    await app.close();
    redis.disconnect();
  });

  it('answers 503 NOT_REGISTERED (never 200) when Redis cannot be reached', async () => {
    ({ app, redis } = await createApp('redis://localhost:6399'));
    const response = await app.inject({
      method: 'POST',
      url: '/api/actas',
      headers: { authorization: `Bearer ${tokenFor(app, jurorFor(table))}`, 'idempotency-key': newIdempotencyKey() },
      payload: buildSubmission(table),
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers['retry-after']).toBeDefined();
    expect(response.json()).toMatchObject({ result: 'NOT_REGISTERED', actaId: table.actaId });
  });
});
