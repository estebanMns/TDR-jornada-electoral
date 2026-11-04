import { compareStreamIds, PUBLIC_METRICS, SSE_EVENTS, type PublicDelta } from '@electoral/shared';
import type { Metrics } from '../../core/metrics';
import { formatSseFrame } from '../../core/transport/sseConnection';
import type { BackpressurePolicy } from './backpressure';
import type { PublicSubscriber } from './subscriber';
import type { TopicRegistry } from './topicRegistry';
import type { DrainedWindow } from './windowAggregator';

/** Gives the event loop back every N sends (RF-4). */
export const BATCH_SIZE = 500;

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

export interface BroadcasterDeps {
  registry: TopicRegistry<PublicSubscriber>;
  policy: BackpressurePolicy;
  metrics: Metrics;
  /** Total connections of the instance (for the naive message count). */
  connectionCount: () => number;
  /** A client went over the lag threshold: resync it when it drains. */
  onLagging: (subscriber: PublicSubscriber) => void;
  now?: () => number;
  batchSize?: number;
}

/**
 * Fan-out of a closed window (RF-4): each topic message is serialized ONCE and
 * the same string goes to every subscriber, in batches that yield to the event
 * loop so 50.000 sends never block it.
 */
export class Broadcaster {
  private readonly now: () => number;
  private readonly batchSize: number;

  constructor(private readonly deps: BroadcasterDeps) {
    this.now = deps.now ?? Date.now;
    this.batchSize = deps.batchSize ?? BATCH_SIZE;
  }

  async publish(window: DrainedWindow): Promise<{ sent: number; naive: number }> {
    const { registry, metrics } = this.deps;
    // Naive design: every event to every connection.
    const naive = window.events * this.deps.connectionCount();
    // Every message of this window carries the same id; lastId advances only
    // at the end, so a client subscribed to several topics gets all of them.
    const delivered = new Set<PublicSubscriber>();
    let sent = 0;

    for (const [topic, changes] of window.topics) {
      const subscribers = registry.subscribers(topic);
      if (subscribers.size === 0) continue;
      const frame = formatSseFrame({
        id: window.untilId,
        event: SSE_EVENTS.delta,
        data: { topic, changes: changes.changes, reasons: changes.reasons, tsRxMin: changes.tsRxMin } satisfies PublicDelta,
      });

      let inBatch = 0;
      for (const subscriber of [...subscribers]) {
        if (this.deliver(subscriber, frame, window.untilId)) {
          delivered.add(subscriber);
          sent += 1;
        }
        if (++inBatch === this.batchSize) {
          inBatch = 0;
          await yieldToEventLoop();
        }
      }
      metrics.observe(PUBLIC_METRICS.publishLatencyMs, this.now() - changes.tsRxMin);
    }

    for (const subscriber of delivered) subscriber.lastId = window.untilId;
    metrics.inc(PUBLIC_METRICS.messagesSent, sent);
    metrics.inc(PUBLIC_METRICS.messagesNaive, naive);
    return { sent, naive };
  }

  /** @returns true when the frame was written to this subscriber. */
  private deliver(subscriber: PublicSubscriber, frame: string, windowId: string): boolean {
    const { connection } = subscriber;
    if (!connection.isOpen) return false;
    if (subscriber.catchingUp) {
      subscriber.missedWindowWhileCatchingUp = true;
      return false;
    }
    if (compareStreamIds(subscriber.lastId, windowId) >= 0) return false;

    const decision = this.deps.policy.decide(subscriber, this.now());
    if (decision === 'disconnect') {
      connection.close('slow-client');
      this.deps.metrics.inc(PUBLIC_METRICS.slowDisconnected);
      return false;
    }
    if (decision === 'skip') {
      if (subscriber.laggingSince === null) {
        subscriber.laggingSince = this.now();
        this.deps.onLagging(subscriber);
      }
      return false;
    }
    connection.send(frame);
    return true;
  }
}
