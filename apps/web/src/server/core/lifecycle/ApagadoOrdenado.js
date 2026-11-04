/**
 * Apagado ordenado ante SIGTERM/SIGINT (docker stop, despliegue).
 * Ejecuta los pasos en el orden registrado, una sola vez, con tiempo máximo.
 */
export class ApagadoOrdenado {
  /** @type {Array<{ nombre: string, paso: () => unknown }>} */
  #pasos = [];
  #enCurso = null;

  /** @param {{ logger: import('pino').Logger, tiempoMaximoMs?: number }} deps */
  constructor({ logger, tiempoMaximoMs = 10_000 }) {
    this.logger = logger.child({ componente: 'apagado' });
    this.tiempoMaximoMs = tiempoMaximoMs;
  }

  /** @param {string} nombre @param {() => unknown} paso */
  agregar(nombre, paso) {
    this.#pasos.push({ nombre, paso });
  }

  escucharSenales() {
    for (const senal of ['SIGTERM', 'SIGINT']) {
      process.once(senal, () => {
        this.logger.info({ senal }, 'apagando');
        this.ejecutar().finally(() => process.exit(0));
      });
    }
  }

  ejecutar() {
    this.#enCurso ??= this.#correrPasos();
    return this.#enCurso;
  }

  async #correrPasos() {
    const limite = setTimeout(() => {
      this.logger.error('apagado excedió el tiempo máximo; se fuerza la salida');
      process.exit(1);
    }, this.tiempoMaximoMs);
    limite.unref();
    for (const { nombre, paso } of this.#pasos) {
      try {
        await paso();
        this.logger.info({ paso: nombre }, 'paso de apagado completado');
      } catch (err) {
        this.logger.warn({ err, paso: nombre }, 'paso de apagado falló');
      }
    }
    clearTimeout(limite);
  }
}
