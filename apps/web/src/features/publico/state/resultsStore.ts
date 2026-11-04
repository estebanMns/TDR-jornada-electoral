import {
  CANDIDATE_IDS,
  compareStreamIds,
  type ChangeReason,
  type PublicDelta,
  type PublicSnapshot,
  type PublicStatus,
  type TopicId,
} from '@electoral/shared';
import type { LiveStatus } from '../../../shared/ui';

export interface Notice {
  acta: string;
  kind: 'CORRECTION' | 'REVERSAL';
  at: number;
}

export interface TopicResults {
  totals: Record<string, number>;
  /** Tables of the level (denominator of "% mesas informadas"). */
  tablesTotal: number;
  updatedAt: number | null;
  /** Shown when a number went down: why it did. */
  notice: Notice | null;
}

export interface ResultsState {
  status: LiveStatus;
  topics: Partial<Record<TopicId, TopicResults>>;
}

/**
 * Minimal external store (no context, no re-render per message): messages are
 * applied to mutable state and React is notified at most once per animation
 * frame (RT-9 / INP), however many messages arrive in between.
 */
export class ResultsStore {
  private state: ResultsState = { status: 'connecting', topics: {} };
  private lastId: string | null = null;
  private readonly listeners = new Set<() => void>();
  private frame: number | null = null;
  private paused = false;
  private connected = false;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ResultsState => this.state;

  applySnapshot(snapshot: PublicSnapshot): void {
    if (!this.accepts(snapshot.id)) return;
    this.updateTopic(snapshot.topic, {
      totals: { ...snapshot.totals },
      tablesTotal: snapshot.tables.total,
      updatedAt: Date.now(),
      notice: null,
    });
  }

  applyDelta(delta: PublicDelta, id: string | null): void {
    if (!this.accepts(id)) return;
    const current = this.state.topics[delta.topic];
    if (!current) return; // a delta before the snapshot cannot be applied on nothing
    const decreased = CANDIDATE_IDS.some((c) => (delta.changes[c] ?? Infinity) < (current.totals[c] ?? 0));
    this.updateTopic(delta.topic, {
      totals: { ...current.totals, ...delta.changes },
      tablesTotal: current.tablesTotal,
      updatedAt: Date.now(),
      notice: decreased ? noticeFrom(delta.reasons) ?? current.notice : current.notice,
    });
  }

  applyStatus(status: PublicStatus): void {
    this.paused = status.paused;
    this.setStatus();
  }

  setConnected(connected: boolean): void {
    this.connected = connected;
    this.setStatus();
  }

  /** Messages are applied only if they are not older than the last one (several topics share an id). */
  private accepts(id: string | null): boolean {
    if (!id) return true;
    if (this.lastId && compareStreamIds(id, this.lastId) < 0) return false;
    this.lastId = id;
    return true;
  }

  private setStatus(): void {
    const status: LiveStatus = this.paused ? 'paused' : this.connected ? 'live' : this.lastId ? 'reconnecting' : 'connecting';
    if (status === this.state.status) return;
    this.state = { ...this.state, status };
    this.schedule();
  }

  private updateTopic(topic: TopicId, results: TopicResults): void {
    this.state = { ...this.state, topics: { ...this.state.topics, [topic]: results } };
    this.schedule();
  }

  private schedule(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      for (const listener of this.listeners) listener();
    });
  }
}

function noticeFrom(reasons: ChangeReason[]): Notice | null {
  const reason = reasons.find((r) => r.type === 'CORRECTION' || r.type === 'REVERSAL');
  return reason ? { acta: reason.acta, kind: reason.type as Notice['kind'], at: Date.now() } : null;
}
