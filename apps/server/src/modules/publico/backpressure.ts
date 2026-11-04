import type { PublicSubscriber } from './subscriber';

export type BackpressureDecision = 'send' | 'skip' | 'disconnect';

/** Slow-client policy (Strategy, RF-9): swappable without touching the fan-out. */
export interface BackpressurePolicy {
  decide(subscriber: PublicSubscriber, now: number): BackpressureDecision;
}

export interface ThresholdPolicyOptions {
  /** Above this, the client stops receiving deltas until it drains. */
  lagBytes?: number;
  /** Above this, the client is disconnected and comes back with its id. */
  dropBytes?: number;
  /** Lagging longer than this → disconnect. */
  maxLagMs?: number;
}

/**
 * > 64 KB pending → skip deltas (lagging); on `drain` it gets a snapshot.
 * > 512 KB pending, or lagging for > 30 s → `reconnect` and close.
 * Memory per connection is therefore bounded (~512 KB worst case).
 */
export class ThresholdBackpressurePolicy implements BackpressurePolicy {
  readonly lagBytes: number;
  readonly dropBytes: number;
  readonly maxLagMs: number;

  constructor({ lagBytes = 64 * 1024, dropBytes = 512 * 1024, maxLagMs = 30_000 }: ThresholdPolicyOptions = {}) {
    this.lagBytes = lagBytes;
    this.dropBytes = dropBytes;
    this.maxLagMs = maxLagMs;
  }

  decide(subscriber: PublicSubscriber, now: number): BackpressureDecision {
    const buffered = subscriber.connection.bufferedBytes();
    if (buffered > this.dropBytes) return 'disconnect';
    if (subscriber.laggingSince !== null) {
      return now - subscriber.laggingSince > this.maxLagMs ? 'disconnect' : 'skip';
    }
    return buffered > this.lagBytes ? 'skip' : 'send';
  }
}
