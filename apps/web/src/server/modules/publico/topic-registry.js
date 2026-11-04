/** Índice O(1) topic -> Set<connection>, sin recorrer todas las conexiones. */
export class TopicRegistry {
  #byTopic = new Map();
  #byConnection = new Map();

  add(topic, conn) {
    let set = this.#byTopic.get(topic);
    if (!set) this.#byTopic.set(topic, (set = new Set()));
    if (set.has(conn)) return false;
    set.add(conn);
    let topics = this.#byConnection.get(conn);
    if (!topics) this.#byConnection.set(conn, (topics = new Set()));
    topics.add(topic);
    return true;
  }

  remove(topic, conn) {
    const set = this.#byTopic.get(topic);
    if (!set?.delete(conn)) return false;
    if (!set.size) this.#byTopic.delete(topic);
    const topics = this.#byConnection.get(conn);
    topics?.delete(topic);
    if (!topics?.size) this.#byConnection.delete(conn);
    return true;
  }

  removeConnection(conn) {
    const topics = this.#byConnection.get(conn);
    if (!topics) return;
    for (const topic of topics) {
      const set = this.#byTopic.get(topic);
      set?.delete(conn);
      if (!set?.size) this.#byTopic.delete(topic);
    }
    this.#byConnection.delete(conn);
  }

  subscribers(topic) { return this.#byTopic.get(topic) ?? EMPTY; }
  count(topic) { return this.#byTopic.get(topic)?.size ?? 0; }
  counts() { return Object.fromEntries([...this.#byTopic].map(([k, v]) => [k, v.size])); }
}
const EMPTY = new Set();
