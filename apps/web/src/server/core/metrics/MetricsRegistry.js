import { Histograma } from './Histograma.js';

/**
 * Métricas en memoria de la instancia (GENERAL §7.5, §11):
 * - `inc(nombre, n)`: contador (total acumulado + tasa por segundo de la ventana).
 * - `observe(nombre, valor)`: histograma por ventana (p50/p99/max).
 * - `gauge(nombre, fn)`: valor leído en el momento de la fotografía.
 */
export class MetricsRegistry {
  /** @type {Map<string, { total: number, ventana: number }>} */
  #contadores = new Map();
  /** @type {Map<string, Histograma>} */
  #histogramas = new Map();
  /** @type {Map<string, () => unknown>} */
  #gauges = new Map();
  #inicioVentana;

  constructor({ reloj = Date.now } = {}) {
    this.reloj = reloj;
    this.#inicioVentana = reloj();
  }

  inc(nombre, n = 1) {
    const c = this.#contadores.get(nombre) ?? { total: 0, ventana: 0 };
    c.total += n;
    c.ventana += n;
    this.#contadores.set(nombre, c);
  }

  observe(nombre, valor) {
    if (!this.#histogramas.has(nombre)) this.#histogramas.set(nombre, new Histograma());
    this.#histogramas.get(nombre).registrar(valor);
  }

  gauge(nombre, lector) {
    this.#gauges.set(nombre, lector);
  }

  /** Fotografía de todas las métricas; cierra la ventana actual. */
  fotografia() {
    const ahora = this.reloj();
    const segundos = Math.max(0.001, (ahora - this.#inicioVentana) / 1000);
    this.#inicioVentana = ahora;

    const contadores = {};
    for (const [nombre, c] of this.#contadores) {
      contadores[nombre] = { total: c.total, porSeg: +(c.ventana / segundos).toFixed(2) };
      c.ventana = 0;
    }
    const histogramas = {};
    for (const [nombre, h] of this.#histogramas) histogramas[nombre] = h.cerrarVentana();

    const gauges = {};
    for (const [nombre, lector] of this.#gauges) {
      try {
        gauges[nombre] = lector();
      } catch {
        gauges[nombre] = null;
      }
    }
    return { ts: ahora, contadores, histogramas, gauges };
  }
}
