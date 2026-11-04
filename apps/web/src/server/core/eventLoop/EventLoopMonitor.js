import { monitorEventLoopDelay } from 'node:perf_hooks';
import { TareaPeriodica } from '../tasks/TareaPeriodica.js';

const NS_A_MS = 1e-6;

/**
 * Retraso del Event Loop (p50/p99/max en ms) por ventanas de 2 s (GENERAL §11).
 * Se registra como gauge `event_loop_ms` en las métricas.
 */
export class EventLoopMonitor extends TareaPeriodica {
  #histograma = monitorEventLoopDelay({ resolution: 10 });
  #ultima = { p50: 0, p99: 0, max: 0 };

  /** @param {{ logger: import('pino').Logger, intervaloMs?: number }} deps */
  constructor({ logger, intervaloMs = 2_000 }) {
    super({ nombre: 'event-loop', intervaloMs, logger, ejecutar: () => this.#leer() });
  }

  iniciar() {
    this.#histograma.enable();
    super.iniciar();
  }

  detener() {
    super.detener();
    this.#histograma.disable();
  }

  ultimaLectura() {
    return this.#ultima;
  }

  /** @param {import('../metrics/MetricsRegistry.js').MetricsRegistry} metrics */
  registrarEn(metrics) {
    metrics.gauge('event_loop_ms', () => this.ultimaLectura());
  }

  #leer() {
    const h = this.#histograma;
    const redondear = (ns) => +(ns * NS_A_MS).toFixed(2);
    this.#ultima = {
      p50: redondear(h.percentile(50)),
      p99: redondear(h.percentile(99)),
      max: redondear(h.max),
    };
    h.reset();
  }
}
