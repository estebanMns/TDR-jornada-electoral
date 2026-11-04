import type { Redis } from 'ioredis';
import { redisKeys, type AccumulatedEvent } from '@electoral/shared';
import { parseEntry } from './publico.repository';

type ReadReply = [stream: string, entries: [string, string[]][]][] | null;

export interface StreamReaderOptions {
  /** DEDICATED connection: XREAD BLOCK holds it while waiting. */
  redis: Redis;
  onEvent: (event: AccumulatedEvent) => void;
  onError?: (error: unknown) => void;
  blockMs?: number;
  batch?: number;
}

/**
 * Reads ALL of `ev:all` with `XREAD BLOCK` (one global channel, GENERAL §8) and
 * hands each event to the window. Keeps its own cursor, so after a Redis outage
 * it resumes exactly where it stopped: the stream lost nothing.
 */
export class StreamReader {
  private cursor = '0-0';
  private running = false;
  private loop: Promise<void> | null = null;

  constructor(private readonly options: StreamReaderOptions) {}

  get position(): string {
    return this.cursor;
  }

  start(fromId: string): void {
    if (this.running) return;
    this.cursor = fromId;
    this.running = true;
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.options.redis.disconnect();
    await this.loop?.catch(() => {});
  }

  private async run(): Promise<void> {
    const { redis, onEvent, onError, blockMs = 1_000, batch = 500 } = this.options;
    while (this.running) {
      try {
        const reply = (await redis.xread('COUNT', batch, 'BLOCK', blockMs, 'STREAMS', redisKeys.eventsAll(), this.cursor)) as ReadReply;
        for (const [, entries] of reply ?? []) {
          for (const entry of entries) {
            this.cursor = entry[0];
            onEvent(parseEntry(entry));
          }
        }
      } catch (error) {
        if (!this.running) return;
        onError?.(error);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
}
