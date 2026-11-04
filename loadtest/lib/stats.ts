import { writeFileSync } from 'node:fs';

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
}

/** Bounded sample (reservoir): memory stays flat over a long run. */
export class Reservoir {
  private readonly values: number[] = [];
  private seen = 0;
  constructor(private readonly size = 5_000) {}

  add(value: number): void {
    this.seen += 1;
    if (this.values.length < this.size) this.values.push(value);
    else {
      const slot = Math.floor(Math.random() * this.seen);
      if (slot < this.size) this.values[slot] = value;
    }
  }

  drain(): number[] {
    const copy = [...this.values];
    this.values.length = 0;
    this.seen = 0;
    return copy;
  }
}

export function writeCsv(path: string, header: string[], rows: (string | number)[][]): void {
  writeFileSync(path, [header.join(','), ...rows.map((r) => r.join(','))].join('\n') + '\n');
}

export const fmt = (n: number) => Math.round(n).toLocaleString('es-CO');
