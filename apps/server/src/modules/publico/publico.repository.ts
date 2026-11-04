import { readFileSync } from 'node:fs';
import type { Redis, Result } from 'ioredis';
import {
  parseAccumulatedEvent,
  redisKeys,
  type AccumulatedEvent,
  type PublicSnapshot,
  type TopicId,
} from '@electoral/shared';

const SNAPSHOT_LUA = readFileSync(new URL('./lua/snapshot.lua', import.meta.url), 'utf8');

declare module 'ioredis' {
  interface RedisCommander<Context> {
    publicSnapshot(...keysAndArgs: string[]): Result<unknown[], Context>;
  }
}

type RawEntry = [id: string, fields: string[]];

/** Totals hash and table-count key of a public topic. */
export function topicKeys(topic: TopicId): { totals: string; tables: string } {
  if (topic === 'dep') {
    return { totals: redisKeys.totalsDepartment(), tables: redisKeys.catalogDepartmentTableCount() };
  }
  const [level, rawId] = topic.split(':');
  const id = Number(rawId);
  return level === 'mun'
    ? { totals: redisKeys.totalsMunicipality(id), tables: redisKeys.catalogMunicipalityTableCount(id) }
    : { totals: redisKeys.totalsStation(id), tables: redisKeys.catalogStationTableCount(id) };
}

export function parseEntry([id, fields]: RawEntry): AccumulatedEvent {
  const map: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) map[fields[i]!] = fields[i + 1]!;
  return parseAccumulatedEvent(id, map);
}

function toNumbers(flat: string[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (let i = 0; i < flat.length; i += 2) totals[flat[i]!] = Number(flat[i + 1]);
  return totals;
}

/** Only place of the public module that knows Redis keys and commands. */
export class PublicoRepository {
  constructor(private readonly redis: Redis) {
    if (typeof (redis as Partial<Redis>).publicSnapshot !== 'function') {
      redis.defineCommand('publicSnapshot', { lua: SNAPSHOT_LUA });
    }
  }

  /** Totals + table counts + last stream id, atomically (snapshot.lua). */
  async snapshot(topics: readonly TopicId[]): Promise<PublicSnapshot[]> {
    const keys = [redisKeys.eventsAll(), ...topics.flatMap((t) => [topicKeys(t).totals, topicKeys(t).tables])];
    const [lastId, ...pairs] = (await this.redis.publicSnapshot(String(keys.length), ...keys)) as [
      string,
      ...(string[] | string)[],
    ];
    return topics.map((topic, index) => {
      const totals = toNumbers(pairs[index * 2] as string[]);
      return {
        id: lastId,
        topic,
        totals,
        tables: { reported: totals._reported ?? 0, total: Number(pairs[index * 2 + 1]) },
      };
    });
  }

  /** Events strictly after `afterId` (at most `limit`). */
  async eventsAfter(afterId: string, limit: number): Promise<AccumulatedEvent[]> {
    const entries = (await this.redis.xrange(redisKeys.eventsAll(), `(${afterId}`, '+', 'COUNT', limit)) as RawEntry[];
    return entries.map(parseEntry);
  }

  /** True when `id` is still in the stream (not trimmed, not invented). */
  async exists(id: string): Promise<boolean> {
    const entries = await this.redis.xrange(redisKeys.eventsAll(), id, id, 'COUNT', 1);
    return entries.length > 0;
  }

  /** Last id of the stream, or `0-0` when empty. Used as the reader's starting cursor. */
  async lastId(): Promise<string> {
    const [last] = (await this.redis.xrevrange(redisKeys.eventsAll(), '+', '-', 'COUNT', 1)) as RawEntry[];
    return last?.[0] ?? '0-0';
  }

  async pushInpSample(value: number, keep = 1_000): Promise<void> {
    await this.redis.multi().lpush(redisKeys.vitalsInp(), value).ltrim(redisKeys.vitalsInp(), 0, keep - 1).exec();
  }

  async inpSamples(): Promise<number[]> {
    return (await this.redis.lrange(redisKeys.vitalsInp(), 0, -1)).map(Number);
  }
}
