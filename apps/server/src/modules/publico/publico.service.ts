import type { Redis } from 'ioredis';
import { PUBLIC_METRICS, SSE_EVENTS, type PublicStatus, type TopicId } from '@electoral/shared';
import type { Metrics } from '../../core/metrics';
import { redisStatus, watchRedisStatus, type RedisStatus } from '../../core/redis';
import type { ClientConnection } from '../../core/transport/clientConnection';
import { formatSseFrame } from '../../core/transport/sseConnection';
import type { BackpressurePolicy } from './backpressure';
import { Broadcaster } from './broadcaster';
import type { PublicoRepository } from './publico.repository';
import { ResumePlanner } from './resumePlanner';
import { StreamReader } from './streamReader';
import { createSubscriber, type PublicSubscriber } from './subscriber';
import { TopicRegistry } from './topicRegistry';
import { WindowAggregator } from './windowAggregator';

/** A client that keeps missing windows while catching up gets one more pass at most this many times. */
const MAX_CATCH_UP_PASSES = 5;
const PING_INTERVAL_MS = 25_000;

export interface PublicStreamServiceDeps {
  /** Command connection (snapshots, replays). */
  redis: Redis;
  /** Dedicated connection for XREAD BLOCK. */
  blockingRedis: Redis;
  repository: PublicoRepository;
  policy: BackpressurePolicy;
  metrics: Metrics;
  windowMs: number;
  logger?: { warn(obj: object, msg: string): void };
  now?: () => number;
}

/**
 * Live public results (RF-4, RF-5, RF-6, RF-9, RF-10). Orchestrates: stream
 * reader → window → fan-out, plus each connection's catch-up and the paused
 * state while Redis is down.
 */
export class PublicStreamService {
  readonly registry = new TopicRegistry<PublicSubscriber>();
  private readonly subscribers = new Set<PublicSubscriber>();
  private readonly aggregator = new WindowAggregator();
  private readonly reader: StreamReader;
  private readonly broadcaster: Broadcaster;
  private readonly planner: ResumePlanner;
  private readonly now: () => number;
  private timers: NodeJS.Timeout[] = [];
  private stopWatchingRedis: (() => void) | null = null;
  private pausedSince: number | null = null;
  private flushing = false;
  private readerPending = false;

  constructor(private readonly deps: PublicStreamServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.planner = new ResumePlanner(deps.repository, this.now);
    this.reader = new StreamReader({
      redis: deps.blockingRedis,
      onEvent: (event) => this.aggregator.add(event),
      onError: (error) => deps.logger?.warn({ err: error }, 'ev:all reader failed; retrying'),
    });
    this.broadcaster = new Broadcaster({
      registry: this.registry,
      policy: deps.policy,
      metrics: deps.metrics,
      connectionCount: () => this.subscribers.size,
      onLagging: (subscriber) => this.resyncWhenDrained(subscriber),
      now: this.now,
    });
    deps.metrics.gauge(PUBLIC_METRICS.sseConnections, () => this.subscribers.size);
    deps.metrics.gauge(PUBLIC_METRICS.laggingClients, () => this.countLagging());
  }

  /** Last `ev:all` id consumed by the reader. */
  get readerPosition(): string {
    return this.reader.position;
  }

  get connectionCount(): number {
    return this.subscribers.size;
  }

  async start(): Promise<void> {
    await this.startReader();
    this.timers.push(setInterval(() => void this.flushWindow(), this.deps.windowMs));
    this.timers.push(setInterval(() => void this.pingAll(), PING_INTERVAL_MS));
    for (const timer of this.timers) timer.unref();
    this.stopWatchingRedis = watchRedisStatus(this.deps.redis, (status) => this.onRedisStatus(status));
    if (redisStatus(this.deps.redis) !== 'ok') this.onRedisStatus('degraded');
  }

  /**
   * The reader starts from a CONCRETE id (never `$`), so after an outage it
   * resumes exactly there. If Redis is down at boot, it starts when it comes back.
   */
  private async startReader(): Promise<void> {
    try {
      this.reader.start(await this.deps.repository.lastId());
    } catch {
      this.readerPending = true;
    }
  }

  async stop(): Promise<void> {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    this.stopWatchingRedis?.();
    await this.reader.stop();
    for (const subscriber of [...this.subscribers]) subscriber.connection.close('server-restart');
  }

  /** Registers a connection and brings it up to date (replay or snapshot). */
  async open(connection: ClientConnection, topics: readonly TopicId[], lastEventId: string | null): Promise<void> {
    const subscriber = createSubscriber(connection, topics);
    this.subscribers.add(subscriber);
    for (const topic of topics) this.registry.add(topic, subscriber);
    connection.onClose(() => this.remove(subscriber));
    if (lastEventId) this.deps.metrics.inc(PUBLIC_METRICS.reconnections);

    if (this.pausedSince !== null) {
      connection.send(this.statusFrame());
      subscriber.needsResync = true;
      subscriber.lastId = lastEventId ?? '0-0';
      return;
    }
    await this.catchUp(subscriber, lastEventId);
  }

  /** Closes the current window and fans it out. Exposed for tests. */
  async flushWindow(): Promise<void> {
    if (this.flushing) return; // the previous window is still being sent
    const window = this.aggregator.drain();
    if (!window) return;
    this.flushing = true;
    try {
      await this.broadcaster.publish(window);
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Replay (or snapshot) while live windows are held back for this client.
   * If a window was missed meanwhile, replays again from where it got to.
   */
  private async catchUp(subscriber: PublicSubscriber, fromId: string | null): Promise<void> {
    subscriber.catchingUp = true;
    let cursor = fromId;
    try {
      for (let pass = 0; pass < MAX_CATCH_UP_PASSES; pass += 1) {
        subscriber.missedWindowWhileCatchingUp = false;
        const plan = await this.planner.plan(subscriber.topics, cursor);
        for (const frame of plan.frames) subscriber.connection.send(frame);
        cursor = plan.lastId;
        if (!subscriber.missedWindowWhileCatchingUp) break;
      }
      subscriber.lastId = cursor ?? '0-0';
      subscriber.needsResync = false;
    } catch (error) {
      subscriber.needsResync = true;
      subscriber.lastId = cursor ?? '0-0';
      this.deps.logger?.warn({ err: error }, 'catch-up failed; will retry when Redis is back');
    } finally {
      subscriber.catchingUp = false;
    }
  }

  /** RF-9: a lagging client gets a fresh snapshot as soon as its buffer drains. */
  private resyncWhenDrained(subscriber: PublicSubscriber): void {
    const stop = subscriber.connection.onDrain(() => {
      stop();
      subscriber.laggingSince = null;
      void this.catchUp(subscriber, null);
    });
  }

  private onRedisStatus(status: RedisStatus): void {
    if (status === 'degraded') {
      if (this.pausedSince !== null) return;
      this.pausedSince = this.now();
    } else {
      if (this.pausedSince === null) return;
      this.pausedSince = null;
    }
    const frame = this.statusFrame();
    for (const subscriber of this.subscribers) subscriber.connection.send(frame);
    if (status === 'ok') {
      if (this.readerPending) {
        this.readerPending = false;
        void this.startReader();
      }
      for (const subscriber of this.subscribers) {
        if (subscriber.needsResync) void this.catchUp(subscriber, subscriber.lastId === '0-0' ? null : subscriber.lastId);
      }
    }
  }

  private statusFrame(): string {
    const data: PublicStatus = this.pausedSince === null ? { paused: false } : { paused: true, since: this.pausedSince };
    return formatSseFrame({ event: SSE_EVENTS.status, data });
  }

  private async pingAll(): Promise<void> {
    let count = 0;
    for (const subscriber of [...this.subscribers]) {
      subscriber.connection.send(': ping\n\n');
      if (++count % 1_000 === 0) await new Promise((resolve) => setImmediate(resolve));
    }
  }

  private remove(subscriber: PublicSubscriber): void {
    this.subscribers.delete(subscriber);
    for (const topic of subscriber.topics) this.registry.remove(topic, subscriber);
  }

  private countLagging(): number {
    let lagging = 0;
    for (const subscriber of this.subscribers) if (subscriber.laggingSince !== null) lagging += 1;
    return lagging;
  }
}
