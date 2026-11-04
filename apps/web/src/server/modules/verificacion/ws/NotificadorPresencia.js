import { MensajeServidor as M } from '@preconteo/shared/schemas/verificacion';

/**
 * Envía `presencia {lista}` a los coordinadores conectados a esta instancia:
 * al cambiar (agrupando ráfagas en `esperaMs`) y periódicamente desde el gateway.
 */
export class NotificadorPresencia {
  #pendiente = null;

  /**
   * @param {{ presencia: import('../presencia.service.js').PresenciaService,
   *           coordinadores: () => Iterable<import('./SesionVerificacion.js').SesionVerificacion>,
   *           logger: import('pino').Logger, esperaMs?: number }} deps
   */
  constructor({ presencia, coordinadores, logger, esperaMs = 500 }) {
    this.presencia = presencia;
    this.coordinadores = coordinadores;
    this.logger = logger;
    this.esperaMs = esperaMs;
  }

  /** Hubo un cambio: notificar pronto, una sola vez por ráfaga. */
  programar() {
    if (this.#pendiente) return;
    this.#pendiente = setTimeout(() => {
      this.#pendiente = null;
      this.enviar().catch((err) => this.logger.warn({ err: err.message }, 'presencia no enviada'));
    }, this.esperaMs);
  }

  /** @param {Iterable<import('./SesionVerificacion.js').SesionVerificacion>} [destinos] */
  async enviar(destinos = this.coordinadores()) {
    const lista = [...destinos];
    if (lista.length === 0) return;
    const texto = JSON.stringify({ tipo: M.PRESENCIA, lista: await this.presencia.listar() });
    for (const sesion of lista) sesion.enviarTexto(texto);
  }

  detener() {
    clearTimeout(this.#pendiente);
    this.#pendiente = null;
  }
}
