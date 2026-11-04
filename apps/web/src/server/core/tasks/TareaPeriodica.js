/**
 * Ejecuta una función cada `intervaloMs` sin solaparse consigo misma
 * (encadena setTimeout en vez de setInterval) y sin tumbar el proceso si falla.
 */
export class TareaPeriodica {
  #temporizador = null;
  #activa = false;

  /**
   * @param {{ nombre: string, intervaloMs: number, ejecutar: () => unknown | Promise<unknown>,
   *           logger: import('pino').Logger, inmediata?: boolean }} opciones
   */
  constructor({ nombre, intervaloMs, ejecutar, logger, inmediata = false }) {
    this.nombre = nombre;
    this.intervaloMs = intervaloMs;
    this.ejecutar = ejecutar;
    this.inmediata = inmediata;
    this.logger = logger;
  }

  iniciar() {
    if (this.#activa) return;
    this.#activa = true;
    this.#programar(this.inmediata ? 0 : this.intervaloMs);
  }

  detener() {
    this.#activa = false;
    clearTimeout(this.#temporizador);
    this.#temporizador = null;
  }

  #programar(espera) {
    if (!this.#activa) return;
    this.#temporizador = setTimeout(() => this.#correr(), espera);
    this.#temporizador.unref?.();
  }

  async #correr() {
    try {
      await this.ejecutar();
    } catch (err) {
      this.logger.warn({ err, tarea: this.nombre }, 'tarea periódica falló');
    } finally {
      this.#programar(this.intervaloMs);
    }
  }
}
