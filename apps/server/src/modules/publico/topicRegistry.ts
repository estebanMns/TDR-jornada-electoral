/**
 * topic → subscribers (RF-5). `add`/`remove` are O(1) and sending a topic
 * walks only ITS subscribers, never every connection of the instance.
 */
export class TopicRegistry<T> {
  private readonly byTopic = new Map<string, Set<T>>();

  add(topic: string, subscriber: T): void {
    let set = this.byTopic.get(topic);
    if (!set) {
      set = new Set();
      this.byTopic.set(topic, set);
    }
    set.add(subscriber);
  }

  remove(topic: string, subscriber: T): void {
    const set = this.byTopic.get(topic);
    if (!set) return;
    set.delete(subscriber);
    if (set.size === 0) this.byTopic.delete(topic);
  }

  subscribers(topic: string): ReadonlySet<T> {
    return this.byTopic.get(topic) ?? EMPTY;
  }

  count(topic: string): number {
    return this.byTopic.get(topic)?.size ?? 0;
  }

  /** Subscriber count per topic (for metrics and the report). */
  counts(): Record<string, number> {
    return Object.fromEntries([...this.byTopic].map(([topic, set]) => [topic, set.size]));
  }
}

const EMPTY: ReadonlySet<never> = new Set();
