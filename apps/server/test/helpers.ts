import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import {
  CANDIDATE_IDS,
  redisKeys,
  VOTE_OPTION_IDS,
  type ActaSubmission,
  type Catalog,
  type CatalogTable,
  type JwtPayload,
  type Votes,
} from '@electoral/shared';
import { generateCatalog } from '../../../scripts/catalog/generateCatalog';
import { loadCatalogIntoRedis } from '../../../scripts/catalog/loadRedis';
import { createRandom, type Random } from '../../../scripts/catalog/random';
import { InMemoryMetrics } from '../src/core/metrics';
import { ActasRepository } from '../src/modules/actas/actas.repository';
import { ActasService } from '../src/modules/actas/actas.service';
import type { PhotoStorage } from '../src/modules/actas/photo.storage';

export const REDIS_TEST_URL = process.env.REDIS_TEST_URL ?? 'redis://localhost:6380';

/** Small catalog: enough tables to spread actas over several stations and municipalities. */
export const TEST_CATALOG: Catalog = generateCatalog(
  { municipalities: 4, stations: 12, tables: 60, minEnabled: 300, maxEnabled: 700 },
  7,
);

export async function createTestRedis(): Promise<Redis> {
  const redis = new Redis(REDIS_TEST_URL, { maxRetriesPerRequest: 1 });
  await redis.flushdb();
  await loadCatalogIntoRedis(redis, TEST_CATALOG);
  return redis;
}

export class MemoryPhotoStorage implements PhotoStorage {
  readonly files = new Map<string, Uint8Array>();
  async put(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(path, bytes);
  }
}

export function createService(redis: Redis, instanceId = 'test') {
  const metrics = new InMemoryMetrics();
  const service = new ActasService({
    repository: new ActasRepository(redis),
    photoStorage: new MemoryPhotoStorage(),
    metrics,
    instanceId,
  });
  return { service, metrics };
}

export function jurorFor(table: CatalogTable): JwtPayload {
  return { sub: `juror-${table.id}`, role: 'JUROR', name: `Juror ${table.id}`, tableId: table.id };
}

/** Random votes whose sum is exactly `voters` (a balanced acta). */
export function balancedVotes(voters: number, random: Random): Votes {
  const votes = Object.fromEntries(VOTE_OPTION_IDS.map((option) => [option, 0])) as Votes;
  for (let i = 0; i < voters; i++) {
    const option = random.next() < 0.9 ? random.pick(CANDIDATE_IDS) : random.pick(['BLANK', 'NULL', 'UNMARKED'] as const);
    votes[option] += 1;
  }
  return votes;
}

export interface SubmissionOptions {
  version?: number;
  doubtful?: boolean;
  random?: Random;
}

export function buildSubmission(table: CatalogTable, options: SubmissionOptions = {}): ActaSubmission {
  const random = options.random ?? createRandom(table.id);
  const voters = random.int(100, Math.min(table.enabled, 300));
  const votes = balancedVotes(voters, random);
  return {
    actaId: table.actaId,
    version: options.version ?? 1,
    tableId: table.id,
    votes,
    // A doubtful acta declares one voter more than it counts.
    voters: options.doubtful ? voters + 1 : voters,
    photoHash: 'a'.repeat(64),
  };
}

export function newIdempotencyKey(): string {
  return randomUUID();
}

export async function readTotals(redis: Redis, key: string): Promise<Record<string, number>> {
  const raw = await redis.hgetall(key);
  return Object.fromEntries(
    Object.entries(raw)
      .map(([field, value]) => [field, Number(value)] as const)
      .filter(([, value]) => value !== 0),
  );
}

/** Snapshot of the department and every municipality (what the public sees). */
export async function readAllTotals(redis: Redis): Promise<Record<string, Record<string, number>>> {
  const snapshot: Record<string, Record<string, number>> = {
    dep: await readTotals(redis, redisKeys.totalsDepartment()),
  };
  for (const municipality of TEST_CATALOG.municipalities) {
    snapshot[`mun:${municipality.id}`] = await readTotals(redis, redisKeys.totalsMunicipality(municipality.id));
  }
  for (const station of TEST_CATALOG.stations) {
    snapshot[`station:${station.id}`] = await readTotals(redis, redisKeys.totalsStation(station.id));
  }
  return snapshot;
}

export function shuffle<T>(items: readonly T[], random: Random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random.next() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export function sumFieldMaps(maps: Record<string, number>[]): Record<string, number> {
  const total: Record<string, number> = {};
  for (const map of maps) {
    for (const [field, value] of Object.entries(map)) total[field] = (total[field] ?? 0) + value;
  }
  return Object.fromEntries(Object.entries(total).filter(([, value]) => value !== 0));
}
