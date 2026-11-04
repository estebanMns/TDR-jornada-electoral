import {
  SSE_EVENTS,
  streamIdTime,
  type PublicDelta,
  type PublicSnapshot,
  type TopicId,
} from '@electoral/shared';
import { formatSseFrame } from '../../core/transport/sseConnection';
import type { PublicoRepository } from './publico.repository';
import { WindowAggregator } from './windowAggregator';

/** Replay is cheaper than a snapshot only up to a point (GENERAL §9.2). */
export const RESUME_LIMITS = {
  maxPendingEvents: 2_000,
  maxAgeMs: 10 * 60_000,
} as const;

export interface ResumePlan {
  kind: 'replay' | 'snapshot';
  /** Already serialized SSE frames, in order. */
  frames: string[];
  /** The client is up to date until this id after receiving the frames. */
  lastId: string;
}

/**
 * Continuity (RF-6): with a known id the client gets ONE merged `delta` per
 * topic with what it missed; otherwise (no id, unknown or trimmed id, too many
 * pending events, too old) it gets a `snapshot`.
 */
export class ResumePlanner {
  constructor(
    private readonly repository: PublicoRepository,
    private readonly now: () => number = Date.now,
  ) {}

  async plan(topics: readonly TopicId[], lastEventId: string | null): Promise<ResumePlan> {
    if (!lastEventId || this.now() - streamIdTime(lastEventId) > RESUME_LIMITS.maxAgeMs) {
      return this.snapshot(topics);
    }
    if (!(await this.repository.exists(lastEventId))) return this.snapshot(topics);

    const events = await this.repository.eventsAfter(lastEventId, RESUME_LIMITS.maxPendingEvents + 1);
    if (events.length > RESUME_LIMITS.maxPendingEvents) return this.snapshot(topics);
    if (events.length === 0) return { kind: 'replay', frames: [], lastId: lastEventId };

    const aggregator = new WindowAggregator();
    const wanted = new Set<string>(topics);
    for (const event of events) aggregator.add(event, wanted);
    const window = aggregator.drain()!;
    const frames = [...window.topics].map(([topic, w]) =>
      formatSseFrame({
        id: window.untilId,
        event: SSE_EVENTS.delta,
        data: { topic, changes: w.changes, reasons: w.reasons, tsRxMin: w.tsRxMin } satisfies PublicDelta,
      }),
    );
    return { kind: 'replay', frames, lastId: window.untilId };
  }

  async snapshot(topics: readonly TopicId[]): Promise<ResumePlan> {
    const snapshots = await this.repository.snapshot(topics);
    const lastId = snapshots[0]?.id ?? '0-0';
    const frames = snapshots.map((snapshot) =>
      formatSseFrame({ id: snapshot.id, event: SSE_EVENTS.snapshot, data: snapshot satisfies PublicSnapshot }),
    );
    return { kind: 'snapshot', frames, lastId };
  }
}
