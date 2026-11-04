import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import { PERSISTENCE_CONSUMER_GROUP, redisKeys, type PersistenceEventKind } from '@electoral/shared';
import type { StoredVersionRecord } from './actas.types';
import type { ActaHistoryStore, PhotoStored, ResolutionRecord, StatusChange } from './history.store';

export interface PersistenceWorkerOptions {
  /** Dedicated connection: blocking reads must not share the command connection. */
  redis: Redis;
  store: ActaHistoryStore;
  /** Consumer name inside the group (the instance id). */
  consumer: string;
  logger: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
  blockMs?: number;
  batchSize?: number;
  claimIntervalMs?: number;
  /** Pending messages idle longer than this belong to a dead consumer. */
  claimMinIdleMs?: number;
  retryDelayMs?: number;
}

type StreamEntry = [id: string, fields: string[]];
type ReadGroupReply = [stream: string, entries: StreamEntry[]][] | null;

function fieldsToObject(fields: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) result[fields[i]!] = fields[i + 1]!;
  return result;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Deferred persistence (GENERAL §8): each instance is a consumer of the
 * `persist` group on `ev:actas`, so every event is processed by ONE instance.
 * A message is acknowledged only after Supabase accepted it; if Supabase is
 * down nothing is acknowledged and ingestion keeps working. Pending messages
 * of a dead instance are taken over with XAUTOCLAIM.
 */
export class PersistenceWorker {
  private running = false;
  private loop: Promise<void> | null = null;
  private claimTimer: NodeJS.Timeout | null = null;
  private readonly stream = redisKeys.eventsActas();
  private readonly blockMs: number;
  private readonly batchSize: number;
  private readonly claimIntervalMs: number;
  private readonly claimMinIdleMs: number;
  private readonly retryDelayMs: number;

  constructor(private readonly options: PersistenceWorkerOptions) {
    this.blockMs = options.blockMs ?? 5_000;
    this.batchSize = options.batchSize ?? 50;
    this.claimIntervalMs = options.claimIntervalMs ?? 30_000;
    this.claimMinIdleMs = options.claimMinIdleMs ?? 60_000;
    this.retryDelayMs = options.retryDelayMs ?? 2_000;
  }

  async start(): Promise<void> {
    await this.ensureGroup();
    this.running = true;
    this.loop = this.run();
    this.claimTimer = setInterval(() => void this.claimAbandoned(), this.claimIntervalMs);
    this.options.logger.info({ consumer: this.options.consumer }, 'persistence worker started');
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.claimTimer) clearInterval(this.claimTimer);
    // Breaks the blocking XREADGROUP.
    this.options.redis.disconnect();
    await this.loop?.catch(() => undefined);
  }

  /** Processes this consumer's pending messages, then new ones. Exposed for tests. */
  async processOnce(blockMs = this.blockMs): Promise<number> {
    const pending = await this.read('0', 0);
    if (pending.length > 0) return this.handleBatch(pending);
    return this.handleBatch(await this.read('>', blockMs));
  }

  /** Takes over messages abandoned by dead consumers. Exposed for tests. */
  async claimAbandoned(): Promise<number> {
    try {
      const [, entries] = (await this.options.redis.xautoclaim(
        this.stream,
        PERSISTENCE_CONSUMER_GROUP,
        this.options.consumer,
        this.claimMinIdleMs,
        '0-0',
        'COUNT',
        this.batchSize,
      )) as [string, StreamEntry[]];
      return await this.handleBatch(entries.filter(([, fields]) => fields !== null));
    } catch (error) {
      if (this.running) this.options.logger.warn({ err: error }, 'XAUTOCLAIM failed');
      return 0;
    }
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        await this.processOnce();
      } catch (error) {
        if (!this.running) break;
        this.options.logger.warn({ err: error }, 'persistence batch failed; retrying');
        await sleep(this.retryDelayMs);
      }
    }
  }

  private async ensureGroup(): Promise<void> {
    try {
      // From the beginning (`0`): events written before the group existed are persisted too.
      await this.options.redis.xgroup('CREATE', this.stream, PERSISTENCE_CONSUMER_GROUP, '0', 'MKSTREAM');
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('BUSYGROUP')) throw error;
    }
  }

  private async read(id: '0' | '>', blockMs: number): Promise<StreamEntry[]> {
    const args: (string | number)[] = ['GROUP', PERSISTENCE_CONSUMER_GROUP, this.options.consumer, 'COUNT', this.batchSize];
    if (blockMs > 0) args.push('BLOCK', blockMs);
    args.push('STREAMS', this.stream, id);
    const reply = (await this.options.redis.call('XREADGROUP', ...args)) as ReadGroupReply;
    return reply?.[0]?.[1] ?? [];
  }

  /** Stops at the first failure so that messages of the same acta keep their order. */
  private async handleBatch(entries: StreamEntry[]): Promise<number> {
    let processed = 0;
    for (const [id, fields] of entries) {
      await this.handle(fieldsToObject(fields));
      await this.options.redis.xack(this.stream, PERSISTENCE_CONSUMER_GROUP, id);
      processed++;
    }
    return processed;
  }

  private async handle(message: Record<string, string>): Promise<void> {
    const kind = message.kind as PersistenceEventKind;
    const data = JSON.parse(message.data ?? '{}') as unknown;
    switch (kind) {
      case 'VERSION':
        return this.options.store.saveVersion(data as StoredVersionRecord);
      case 'STATUS':
        return this.options.store.updateStatus(data as StatusChange);
      case 'RESOLUTION':
        return this.options.store.saveResolution(data as ResolutionRecord);
      case 'PHOTO':
        return this.options.store.setPhotoPath(data as PhotoStored);
      default:
        this.options.logger.error({ message }, 'unknown persistence event; acknowledging to unblock the stream');
    }
  }
}
