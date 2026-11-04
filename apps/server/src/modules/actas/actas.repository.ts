import { readFileSync } from 'node:fs';
import type { Redis, Result } from 'ioredis';
import {
  CANDIDATE_IDS,
  redisChannels,
  redisKeys,
  STREAM_LIMITS,
  type ActaStatus,
} from '@preconteo/contracts';
import type {
  ApplyActaContext,
  ApplyActaOutcome,
  CatalogTableEntry,
  StoredActaState,
  StoredVersionRecord,
} from './actas.types';

const APPLY_ACTA_LUA = readFileSync(new URL('./lua/apply_acta.lua', import.meta.url), 'utf8');

/** 24 h: covers a full election day of retries. */
export const IDEMPOTENCY_TTL_SECONDS = 86_400;

/** Placeholder KEYS[1] when a call has no idempotency key (resolutions). */
const NO_IDEMPOTENCY_KEY = redisKeys.idempotency('-');

declare module 'ioredis' {
  interface RedisCommander<Context> {
    applyActa(...keysAndArgs: string[]): Result<string, Context>;
  }
}

/**
 * Only place of the actas module that knows Redis keys and commands.
 * The catalog is immutable during the election, so it is cached in memory.
 */
export class ActasRepository {
  private readonly catalogCache = new Map<number, CatalogTableEntry>();

  constructor(private readonly redis: Redis) {
    if (typeof (redis as Partial<Redis>).applyActa !== 'function') {
      redis.defineCommand('applyActa', { numberOfKeys: 15, lua: APPLY_ACTA_LUA });
    }
  }

  async findCatalogTable(tableId: number): Promise<CatalogTableEntry | null> {
    const cached = this.catalogCache.get(tableId);
    if (cached) return cached;
    const entry = await this.redis.hgetall(redisKeys.catalogTable(tableId));
    if (!entry.actaId) return null;
    const table: CatalogTableEntry = {
      tableId,
      stationId: Number(entry.station),
      munId: Number(entry.mun),
      enabled: Number(entry.enabled),
      actaId: entry.actaId,
    };
    this.catalogCache.set(tableId, table);
    return table;
  }

  async applyActa(context: ApplyActaContext): Promise<ApplyActaOutcome> {
    const { actaId, version, tableId, stationId, munId } = context;
    const idempotencyKey =
      context.mode === 'SUBMIT' && context.idempotencyKey
        ? redisKeys.idempotency(context.idempotencyKey)
        : NO_IDEMPOTENCY_KEY;

    const keys = [
      idempotencyKey,
      redisKeys.acta(actaId),
      redisKeys.actaVersion(actaId, version),
      redisKeys.jurorActas(context.mode === 'SUBMIT' ? context.juror : '-'),
      redisKeys.totalsTable(tableId),
      redisKeys.totalsStation(stationId),
      redisKeys.totalsMunicipality(munId),
      redisKeys.totalsDepartment(),
      redisKeys.rankStation(stationId),
      redisKeys.rankMunicipality(munId),
      redisKeys.rankDepartment(),
      redisKeys.eventsAll(),
      redisKeys.eventsActas(),
      redisKeys.verificationQueue(),
      redisKeys.verificationCase(actaId),
    ];
    const args = {
      ...context,
      rankFields: CANDIDATE_IDS,
      idemTtlSeconds: IDEMPOTENCY_TTL_SECONDS,
      evAllMaxLen: STREAM_LIMITS.eventsAll,
      evActasMaxLen: STREAM_LIMITS.eventsActas,
      verificationChannel: redisChannels.verification,
    };
    const raw = await this.redis.applyActa(...keys, JSON.stringify(args));
    return JSON.parse(raw) as ApplyActaOutcome;
  }

  async findVersion(actaId: string, version: number): Promise<StoredVersionRecord | null> {
    const raw = await this.redis.get(redisKeys.actaVersion(actaId, version));
    return raw ? (JSON.parse(raw) as StoredVersionRecord) : null;
  }

  async listJurorActas(jurorSub: string): Promise<StoredActaState[]> {
    const actaIds = await this.redis.smembers(redisKeys.jurorActas(jurorSub));
    if (actaIds.length === 0) return [];
    const pipeline = this.redis.pipeline();
    for (const actaId of actaIds) {
      pipeline.hmget(redisKeys.acta(actaId), 'tableId', 'vmax', 'vapplied', 'status', 'reason', 'updatedAt');
    }
    const rows = (await pipeline.exec()) ?? [];
    return actaIds
      .map((actaId, index): StoredActaState | null => {
        const [error, values] = rows[index] ?? [];
        if (error) throw error;
        const [tableId, vmax, vapplied, status, reason, updatedAt] = values as (string | null)[];
        if (!status) return null;
        return {
          actaId,
          tableId: Number(tableId),
          maxVersion: Number(vmax),
          appliedVersion: Number(vapplied),
          status: status as ActaStatus,
          ...(reason ? { reason } : {}),
          updatedAt: Number(updatedAt),
        };
      })
      .filter((state): state is StoredActaState => state !== null)
      .sort((a, b) => a.actaId.localeCompare(b.actaId));
  }

  /** Records that the photo of a version is stored, for the persistence worker. */
  async recordPhotoStored(actaId: string, version: number, path: string): Promise<void> {
    await this.redis.xadd(
      redisKeys.eventsActas(),
      'MAXLEN',
      '~',
      STREAM_LIMITS.eventsActas,
      '*',
      'kind',
      'PHOTO',
      'data',
      JSON.stringify({ actaId, version, path }),
    );
  }
}
