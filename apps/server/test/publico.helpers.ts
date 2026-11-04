import { EventEmitter } from 'node:events';
import type { Redis } from 'ioredis';
import { redisKeys, type PublicDelta, type PublicSnapshot } from '@electoral/shared';
import { InMemoryMetrics } from '../src/core/metrics';
import type { ClientConnection } from '../src/core/transport/clientConnection';
import { ThresholdBackpressurePolicy, type BackpressurePolicy } from '../src/modules/publico/backpressure';
import { PublicoRepository } from '../src/modules/publico/publico.repository';
import { PublicStreamService } from '../src/modules/publico/publico.service';
import { REDIS_TEST_URL } from './helpers';
import { Redis as IORedis } from 'ioredis';

let sequence = 0;

/** In-memory ClientConnection: records frames; buffer size is controllable. */
export class FakeConnection implements ClientConnection {
  readonly id = `fake-${++sequence}`;
  readonly kind = 'sse' as const;
  readonly frames: string[] = [];
  buffered = 0;
  closedWith: string | null = null;
  private readonly events = new EventEmitter();

  get isOpen(): boolean {
    return this.closedWith === null;
  }

  send(frame: string): boolean {
    if (!this.isOpen) return false;
    this.frames.push(frame);
    return true;
  }

  bufferedBytes(): number {
    return this.buffered;
  }

  close(reason: string): void {
    if (!this.isOpen) return;
    this.closedWith = reason;
    this.events.emit('close');
  }

  onDrain(listener: () => void): () => void {
    this.events.on('drain', listener);
    return () => this.events.off('drain', listener);
  }

  onClose(listener: () => void): () => void {
    this.events.once('close', listener);
    return () => this.events.off('close', listener);
  }

  drain(): void {
    this.buffered = 0;
    this.events.emit('drain');
  }

  messages(): ParsedFrame[] {
    return this.frames.map(parseFrame).filter((f): f is ParsedFrame => f !== null);
  }
}

export interface ParsedFrame {
  id?: string;
  event?: string;
  data: unknown;
}

export function parseFrame(frame: string): ParsedFrame | null {
  const parsed: Partial<ParsedFrame> = {};
  const data: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('id: ')) parsed.id = line.slice(4);
    else if (line.startsWith('event: ')) parsed.event = line.slice(7);
    else if (line.startsWith('data: ')) data.push(line.slice(6));
  }
  if (data.length === 0) return null;
  return { ...parsed, data: JSON.parse(data.join('\n')) };
}

/** What a browser would hold after applying every message, per topic (zeros removed). */
export function clientState(connection: FakeConnection): Record<string, Record<string, number>> {
  const state: Record<string, Record<string, number>> = {};
  for (const message of connection.messages()) {
    if (message.event === 'snapshot') {
      const snapshot = message.data as PublicSnapshot;
      state[snapshot.topic] = { ...snapshot.totals };
    } else if (message.event === 'delta') {
      const delta = message.data as PublicDelta;
      state[delta.topic] = { ...state[delta.topic], ...delta.changes };
    }
  }
  return withoutZeros(state);
}

export function withoutZeros(state: Record<string, Record<string, number>>) {
  return Object.fromEntries(
    Object.entries(state).map(([topic, fields]) => [
      topic,
      Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== 0)),
    ]),
  );
}

export function lastId(connection: FakeConnection): string | null {
  return connection.messages().filter((m) => m.id).at(-1)?.id ?? null;
}

export interface TestPublicService {
  service: PublicStreamService;
  metrics: InMemoryMetrics;
  repository: PublicoRepository;
  blocking: Redis;
  /** Waits until the reader consumed every event currently in ev:all. */
  caughtUpWithStream: () => Promise<void>;
}

export async function createPublicService(
  redis: Redis,
  options: { policy?: BackpressurePolicy; now?: () => number } = {},
): Promise<TestPublicService> {
  const metrics = new InMemoryMetrics();
  const repository = new PublicoRepository(redis);
  const blocking = new IORedis(REDIS_TEST_URL, { maxRetriesPerRequest: null });
  const service = new PublicStreamService({
    redis,
    blockingRedis: blocking,
    repository,
    policy: options.policy ?? new ThresholdBackpressurePolicy(),
    metrics,
    windowMs: 60_000, // windows are closed by hand in the tests
    now: options.now,
  });
  await service.start();
  const caughtUpWithStream = async () => {
    const target = await repository.lastId();
    for (let i = 0; i < 200; i++) {
      if (service.readerPosition === target) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`reader stuck at ${service.readerPosition}, expected ${target}`);
  };
  return { service, metrics, repository, blocking, caughtUpWithStream };
}

export async function readTopicTotals(redis: Redis, topics: string[]) {
  const state: Record<string, Record<string, number>> = {};
  for (const topic of topics) {
    const [level, id] = topic.split(':');
    const key =
      topic === 'dep'
        ? redisKeys.totalsDepartment()
        : level === 'mun'
          ? redisKeys.totalsMunicipality(Number(id))
          : redisKeys.totalsStation(Number(id));
    state[topic] = Object.fromEntries(Object.entries(await redis.hgetall(key)).map(([k, v]) => [k, Number(v)]));
  }
  return withoutZeros(state);
}
