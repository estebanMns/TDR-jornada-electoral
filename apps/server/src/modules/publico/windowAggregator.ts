import type { AccumulatedEvent, ChangeReason, TopicId } from '@electoral/shared';

/** What changed in one topic during a window. */
export interface TopicWindow {
  changes: Record<string, number>;
  reasons: ChangeReason[];
  tsRxMin: number;
}

export interface DrainedWindow {
  /** Id of the last event merged (the SSE id of every message of this window). */
  untilId: string;
  events: number;
  topics: Map<TopicId, TopicWindow>;
}

/** Keeps only a few reasons per message: enough to explain a decrease. */
const MAX_REASONS = 10;

/**
 * Merges events per topic during a window (RF-4). Values are ABSOLUTE, so the
 * last one wins and merging the same event twice is harmless.
 */
export class WindowAggregator {
  private topics = new Map<TopicId, TopicWindow>();
  private untilId: string | null = null;
  private events = 0;

  /** @param only when given, ignores topics outside this set (used by replay). */
  add(event: AccumulatedEvent, only?: ReadonlySet<string>): void {
    this.untilId = event.id;
    this.events += 1;
    for (const [topic, values] of Object.entries(event.abs) as [TopicId, Record<string, number>][]) {
      if (only && !only.has(topic)) continue;
      let window = this.topics.get(topic);
      if (!window) {
        window = { changes: {}, reasons: [], tsRxMin: event.tsRx };
        this.topics.set(topic, window);
      }
      Object.assign(window.changes, values);
      window.tsRxMin = Math.min(window.tsRxMin, event.tsRx);
      if (window.reasons.length < MAX_REASONS && event.type !== 'APPLIED') {
        window.reasons.push({ acta: event.acta, type: event.type, reason: event.reason });
      }
    }
  }

  get isEmpty(): boolean {
    return this.untilId === null;
  }

  /** Returns the window and starts a new one. */
  drain(): DrainedWindow | null {
    if (this.untilId === null) return null;
    const drained = { untilId: this.untilId, events: this.events, topics: this.topics };
    this.topics = new Map();
    this.untilId = null;
    this.events = 0;
    return drained;
  }
}
