/**
 * Bootstrap core (platform owner: Meneses). Same interface as GENERAL §7.5:
 * `inc`, `observe`, `gauge`. This in-memory version only keeps local values.
 */
export interface Metrics {
  inc(name: string, value?: number): void;
  observe(name: string, value: number): void;
  gauge(name: string, read: () => number): void;
}

export class InMemoryMetrics implements Metrics {
  readonly counters = new Map<string, number>();
  readonly observations = new Map<string, number[]>();
  readonly gauges = new Map<string, () => number>();

  inc(name: string, value = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }

  observe(name: string, value: number): void {
    const values = this.observations.get(name) ?? [];
    values.push(value);
    if (values.length > 1_000) values.shift();
    this.observations.set(name, values);
  }

  gauge(name: string, read: () => number): void {
    this.gauges.set(name, read);
  }
}
