import type { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PERSISTENCE_CONSUMER_GROUP, redisKeys } from '@electoral/shared';
import type { StoredVersionRecord } from '../src/modules/actas/actas.types';
import {
  HistoryRowMissingError,
  type ActaHistoryStore,
  type PhotoStored,
  type ResolutionRecord,
  type StatusChange,
} from '../src/modules/actas/history.store';
import { PersistenceWorker } from '../src/modules/actas/persistence.worker';
import { buildSubmission, createService, createTestRedis, jurorFor, newIdempotencyKey, TEST_CATALOG } from './helpers';

class FakeHistoryStore implements ActaHistoryStore {
  readonly versions = new Map<string, StoredVersionRecord & { photoPath?: string }>();
  readonly resolutions: ResolutionRecord[] = [];
  available = true;

  async saveVersion(record: StoredVersionRecord): Promise<void> {
    this.ensureAvailable();
    const key = `${record.actaId}:${record.version}`;
    if (!this.versions.has(key)) this.versions.set(key, { ...record });
  }

  async updateStatus(change: StatusChange): Promise<void> {
    this.ensureAvailable();
    this.row(change.actaId, change.version).status = change.status;
  }

  async saveResolution(resolution: ResolutionRecord): Promise<void> {
    this.ensureAvailable();
    this.resolutions.push(resolution);
    await this.updateStatus(resolution);
  }

  async setPhotoPath(photo: PhotoStored): Promise<void> {
    this.ensureAvailable();
    this.row(photo.actaId, photo.version).photoPath = photo.path;
  }

  private row(actaId: string, version: number) {
    const row = this.versions.get(`${actaId}:${version}`);
    if (!row) throw new HistoryRowMissingError(actaId, version);
    return row;
  }

  private ensureAvailable(): void {
    if (!this.available) throw new Error('Supabase unavailable');
  }
}

const silentLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

describe('persistence worker', () => {
  let redis: Redis;
  let workerRedis: Redis;
  let store: FakeHistoryStore;
  let worker: PersistenceWorker;

  beforeEach(async () => {
    redis = await createTestRedis();
    workerRedis = redis.duplicate();
    store = new FakeHistoryStore();
    worker = new PersistenceWorker({ redis: workerRedis, store, consumer: 'app1', logger: silentLogger, claimMinIdleMs: 0 });
    await worker['ensureGroup']();
  });

  afterEach(() => {
    redis.disconnect();
    workerRedis.disconnect();
  });

  async function submitDoubtfulAndResolve(): Promise<void> {
    const { service } = createService(redis);
    const table = TEST_CATALOG.tables[0]!;
    await service.submit({
      submission: buildSubmission(table, { doubtful: true }),
      idempotencyKey: newIdempotencyKey(),
      juror: jurorFor(table),
    });
    await service.applyResolution({
      actaId: table.actaId,
      version: 1,
      decision: 'APPROVE',
      auditor: 'auditor-1',
      fencing: 7,
    });
  }

  it('persists versions and resolutions in order and acknowledges them', async () => {
    await submitDoubtfulAndResolve();

    expect(await worker.processOnce(0)).toBe(2);
    const [row] = store.versions.values();
    expect(row).toMatchObject({ version: 1, status: 'APPLIED' });
    expect(store.resolutions[0]).toMatchObject({ decision: 'APPROVE', fencing: 7 });

    const pending = (await redis.xpending(redisKeys.eventsActas(), PERSISTENCE_CONSUMER_GROUP)) as [number];
    expect(pending[0]).toBe(0);
  });

  it('does not acknowledge while Supabase is down and catches up afterwards', async () => {
    await submitDoubtfulAndResolve();
    store.available = false;
    await expect(worker.processOnce(0)).rejects.toThrow('Supabase unavailable');

    store.available = true;
    expect(await worker.processOnce(0)).toBe(2);
    expect([...store.versions.values()][0]?.status).toBe('APPLIED');
  });

  it('takes over the pending messages of a dead instance', async () => {
    await submitDoubtfulAndResolve();
    const deadRedis = redis.duplicate();
    const dead = new PersistenceWorker({ redis: deadRedis, store, consumer: 'app2', logger: silentLogger });
    // app2 receives both messages and dies before acknowledging them.
    store.available = false;
    await expect(dead.processOnce(0)).rejects.toThrow('Supabase unavailable');
    deadRedis.disconnect();
    store.available = true;

    expect(await worker.claimAbandoned()).toBe(2);
    expect(store.versions.size).toBe(1);
  });
});
