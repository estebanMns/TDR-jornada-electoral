import { PUBLIC_METRICS } from '@electoral/shared';
import type { Metrics } from '../../core/metrics';
import type { PublicoRepository } from './publico.repository';

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
}

/**
 * INP of the public page (RT-9). Samples are shared by every instance
 * (`vitals:inp`, last 1.000); each instance recomputes the p75 every 10 s
 * and exposes it as the `inp_p75` gauge.
 */
export class VitalsService {
  private p75 = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repository: PublicoRepository,
    metrics: Metrics,
  ) {
    metrics.gauge(PUBLIC_METRICS.inpP75, () => this.p75);
  }

  record(value: number): Promise<void> {
    return this.repository.pushInpSample(Math.round(value));
  }

  async refresh(): Promise<number> {
    this.p75 = percentile(await this.repository.inpSamples(), 0.75);
    return this.p75;
  }

  start(intervalMs = 10_000): void {
    this.timer = setInterval(() => void this.refresh().catch(() => {}), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
