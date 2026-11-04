/**
 * Guarantees of the ingestion module (docs/tareas/jose.md, "Pruebas necesarias").
 * They run against a real Redis because the guarantees live in the Lua script.
 */
import type { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { redisKeys, type ActaSubmission, type JwtPayload } from '@preconteo/contracts';
import { casoVerificacionSchema, scoreDeCaso } from '@preconteo/shared/schemas/verificacion';
import { createRandom } from '../../../scripts/catalog/random';
import type { ActasService } from '../src/modules/actas/actas.service';
import {
  buildSubmission,
  createService,
  createTestRedis,
  jurorFor,
  newIdempotencyKey,
  readAllTotals,
  readTotals,
  shuffle,
  sumFieldMaps,
  TEST_CATALOG,
} from './helpers';

let redis: Redis;
let service: ActasService;

beforeEach(async () => {
  redis?.disconnect();
  redis = await createTestRedis();
  ({ service } = createService(redis));
});

afterAll(() => redis?.disconnect());

const firstTable = TEST_CATALOG.tables[0]!;

describe('RF-1 idempotency', () => {
  it('adds an acta sent 5 times exactly once and answers coherently', async () => {
    const submission = buildSubmission(firstTable);
    const idempotencyKey = newIdempotencyKey();
    const juror = jurorFor(firstTable);

    const receipts = [];
    for (let i = 0; i < 5; i++) receipts.push(await service.submit({ submission, idempotencyKey, juror }));

    expect(receipts.map((r) => r.result)).toEqual([
      'REGISTERED',
      'ALREADY_REGISTERED',
      'ALREADY_REGISTERED',
      'ALREADY_REGISTERED',
      'ALREADY_REGISTERED',
    ]);
    expect(new Set(receipts.map((r) => r.receiptId)).size).toBe(1);
    expect(new Set(receipts.map((r) => r.registeredAt)).size).toBe(1);

    const department = await readTotals(redis, redisKeys.totalsDepartment());
    expect(department._reported).toBe(1);
    expect(department._voters).toBe(submission.voters);
    expect(department.C1 ?? 0).toBe(submission.votes.C1);
    expect(await redis.xlen(redisKeys.eventsAll())).toBe(1);
  });

  it('still answers ALREADY_REGISTERED without adding when the idempotency key expired', async () => {
    const submission = buildSubmission(firstTable);
    const juror = jurorFor(firstTable);
    const first = await service.submit({ submission, idempotencyKey: newIdempotencyKey(), juror });

    const idempotencyKeys = await redis.keys(redisKeys.idempotency('*'));
    await redis.del(...idempotencyKeys);

    const retry = await service.submit({ submission, idempotencyKey: newIdempotencyKey(), juror });
    expect(retry.result).toBe('ALREADY_REGISTERED');
    expect(retry.receiptId).toBe(first.receiptId);

    const department = await readTotals(redis, redisKeys.totalsDepartment());
    expect(department._reported).toBe(1);
    expect(department._voters).toBe(submission.voters);
  });

  it('rejects an idempotency key reused for different content', async () => {
    const idempotencyKey = newIdempotencyKey();
    const juror = jurorFor(firstTable);
    await service.submit({ submission: buildSubmission(firstTable), idempotencyKey, juror });
    const different = { ...buildSubmission(firstTable), voters: 1, votes: { ...buildSubmission(firstTable).votes } };
    await expect(service.submit({ submission: different, idempotencyKey, juror })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
  });
});

describe('RF-2 convergence', () => {
  interface Delivery {
    submission: ActaSubmission;
    juror: JwtPayload;
    idempotencyKey: string;
  }

  /** Versions 1..3 of several actas; some versions are doubtful (including some max versions). */
  function buildDeliveries(): Delivery[] {
    const random = createRandom(99);
    return TEST_CATALOG.tables.slice(0, 12).flatMap((table) =>
      [1, 2, 3].map((version) => ({
        submission: buildSubmission(table, {
          version,
          doubtful: random.next() < 0.25,
          random: createRandom(table.id * 10 + version),
        }),
        juror: jurorFor(table),
        idempotencyKey: `${table.actaId}-v${version}`,
      })),
    );
  }

  it('reaches the same totals for 10 random delivery orders', async () => {
    const deliveries = buildDeliveries();
    const random = createRandom(2026);
    const snapshots: string[] = [];

    for (let permutation = 0; permutation < 10; permutation++) {
      redis.disconnect();
      redis = await createTestRedis();
      ({ service } = createService(redis));
      for (const delivery of shuffle(deliveries, random)) await service.submit(delivery);
      snapshots.push(JSON.stringify(await readAllTotals(redis)));
    }

    expect(new Set(snapshots).size).toBe(1);
    const department = JSON.parse(snapshots[0]!).dep as Record<string, number>;
    expect(department._reported).toBeGreaterThan(0);
  });

  it('answers OBSOLETE to a late lower version without touching the totals', async () => {
    const juror = jurorFor(firstTable);
    const v2 = buildSubmission(firstTable, { version: 2, random: createRandom(1) });
    const v1 = buildSubmission(firstTable, { version: 1, random: createRandom(2) });
    await service.submit({ submission: v2, idempotencyKey: newIdempotencyKey(), juror });
    const before = await readAllTotals(redis);

    const late = await service.submit({ submission: v1, idempotencyKey: newIdempotencyKey(), juror });
    expect(late.result).toBe('OBSOLETE');
    expect(await readAllTotals(redis)).toEqual(before);
  });

  it('reverts a published value when a correction is doubtful and explains it', async () => {
    const juror = jurorFor(firstTable);
    await service.submit({ submission: buildSubmission(firstTable), idempotencyKey: newIdempotencyKey(), juror });
    const doubtful = buildSubmission(firstTable, { version: 2, doubtful: true, random: createRandom(5) });
    const receipt = await service.submit({ submission: doubtful, idempotencyKey: newIdempotencyKey(), juror });

    expect(receipt.result).toBe('UNDER_REVIEW');
    expect(await readTotals(redis, redisKeys.totalsDepartment())).toEqual({});
    const events = await redis.xrange(redisKeys.eventsAll(), '-', '+');
    const last = Object.fromEntries(chunkPairs(events.at(-1)![1]));
    expect(last).toMatchObject({ type: 'REVERSAL', reason: 'UNDER_REVIEW', version: '2' });
    expect(JSON.parse(last.abs!).dep._reported).toBe(0);
    expect(await redis.zscore(redisKeys.verificationQueue(), firstTable.actaId)).not.toBeNull();
  });

  it('sends same-version different content to review as CONFLICT', async () => {
    const juror = jurorFor(firstTable);
    await service.submit({ submission: buildSubmission(firstTable), idempotencyKey: newIdempotencyKey(), juror });
    const other = buildSubmission(firstTable, { random: createRandom(77) });
    const receipt = await service.submit({ submission: other, idempotencyKey: newIdempotencyKey(), juror });

    expect(receipt.result).toBe('CONFLICT');
    expect(await readTotals(redis, redisKeys.totalsDepartment())).toEqual({});
    const raw = await redis.get(redisKeys.verificationCase(firstTable.actaId));
    expect(JSON.parse(raw!)).toMatchObject({ motivo: 'CONFLICTO', prioridad: 1, votosEnConflicto: other.votes });
  });
});

describe('Contract with the verification module', () => {
  it('writes review cases that the platform schema accepts, scored with scoreDeCaso', async () => {
    const juror = jurorFor(firstTable);
    const doubtful = buildSubmission(firstTable, { doubtful: true });
    await service.submit({ submission: doubtful, idempotencyKey: newIdempotencyKey(), juror });

    const raw = await redis.get(redisKeys.verificationCase(firstTable.actaId));
    const parsed = casoVerificacionSchema.safeParse(JSON.parse(raw!));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    const station = TEST_CATALOG.stations.find((s) => s.id === firstTable.stationId)!;
    expect(parsed.data).toMatchObject({
      acta: firstTable.actaId,
      motivo: 'DESCUADRE',
      mesa: firstTable.id,
      puesto: { id: station.id, nombre: station.name },
      sufragantes: doubtful.voters,
      habilitados: firstTable.enabled,
    });
    const score = await redis.zscore(redisKeys.verificationQueue(), firstTable.actaId);
    expect(Number(score)).toBe(scoreDeCaso(parsed.data!));
  });

  it('removes the pending case when a newer valid version arrives', async () => {
    const juror = jurorFor(firstTable);
    await service.submit({
      submission: buildSubmission(firstTable, { doubtful: true }),
      idempotencyKey: newIdempotencyKey(),
      juror,
    });
    await service.submit({
      submission: buildSubmission(firstTable, { version: 2 }),
      idempotencyKey: newIdempotencyKey(),
      juror,
    });
    expect(await redis.get(redisKeys.verificationCase(firstTable.actaId))).toBeNull();
    expect(await redis.zscore(redisKeys.verificationQueue(), firstTable.actaId)).toBeNull();
  });
});

describe('RF-3 atomic hierarchical totals', () => {
  it('keeps department = Σ municipalities = Σ stations after 500 random actas', async () => {
    const random = createRandom(500);
    for (let i = 0; i < 500; i++) {
      const table = random.pick(TEST_CATALOG.tables);
      const submission = buildSubmission(table, {
        version: random.int(1, 4),
        doubtful: random.next() < 0.15,
        random: createRandom(i),
      });
      await service.submit({ submission, idempotencyKey: newIdempotencyKey(), juror: jurorFor(table) });
    }

    const totals = await readAllTotals(redis);
    const municipalities = TEST_CATALOG.municipalities.map((m) => totals[`mun:${m.id}`]!);
    const stations = TEST_CATALOG.stations.map((s) => totals[`station:${s.id}`]!);
    expect(totals.dep!._reported).toBeGreaterThan(0);
    expect(sumFieldMaps(municipalities)).toEqual(totals.dep);
    expect(sumFieldMaps(stations)).toEqual(totals.dep);

    const ranking = await redis.zrevrange(redisKeys.rankDepartment(), 0, -1, 'WITHSCORES');
    for (let i = 0; i < ranking.length; i += 2) {
      expect(Number(ranking[i + 1])).toBe(totals.dep![ranking[i]!] ?? 0);
    }
  });
});

describe('Auditor resolution', () => {
  it('applies an approved doubtful version with the same script', async () => {
    const juror = jurorFor(firstTable);
    const doubtful = buildSubmission(firstTable, { doubtful: true });
    await service.submit({ submission: doubtful, idempotencyKey: newIdempotencyKey(), juror });

    const corrected = { ...doubtful.votes };
    const resolution = await service.applyResolution({
      actaId: firstTable.actaId,
      version: 1,
      decision: 'APPROVE_WITH_CORRECTION',
      votes: corrected,
      voters: doubtful.voters - 1,
      auditor: 'auditor-1',
      fencing: 1,
    });

    expect(resolution).toMatchObject({ result: 'RESOLVED', status: 'APPLIED' });
    const department = await readTotals(redis, redisKeys.totalsDepartment());
    expect(department._reported).toBe(1);
    expect(department._voters).toBe(doubtful.voters - 1);

    const again = await service.applyResolution({
      actaId: firstTable.actaId,
      version: 1,
      decision: 'APPROVE',
      auditor: 'auditor-2',
      fencing: 2,
    });
    expect(again.result).toBe('NOT_UNDER_REVIEW');
  });
});

function chunkPairs(flat: string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < flat.length; i += 2) pairs.push([flat[i]!, flat[i + 1]!]);
  return pairs;
}
