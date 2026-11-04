import { ClientConnection } from './ClientConnection.js';

/** Códigos de cierre WebSocket usados por la plataforma. */
export const CodigoCierreWs = Object.freeze({
  NORMAL: 1000,
  VIOLACION_POLITICA: 1008,
  REINICIO_SERVICIO: 1012,
});

/**
 * Conexión WebSocket (`ws`). `drain` se detecta con el callback de `send`:
 * cuando la librería entrega los datos al socket y el buffer queda en 0.
 */
export class WsConnection extends ClientConnection {
  #ws;
  #viva = true;

  /** @param {import('ws').WebSocket} ws */
  constructor(ws) {
    super('ws');
    this.#ws = ws;
    ws.on('pong', () => {
      this.#viva = true;
    });
    ws.on('close', (codigo) => this.marcarCerrada(String(codigo)));
    ws.on('error', () => this.marcarCerrada('error'));
  }

  /** @param {(texto: string) => void} manejador */
  onMessage(manejador) {
    this.#ws.on('message', (datos, esBinario) => {
      if (!esBinario) manejador(datos.toString());
    });
  }

  send(texto) {
    if (!this.abierta || this.#ws.readyState !== this.#ws.OPEN) return false;
    this.#ws.send(texto, () => {
      if (this.#ws.bufferedAmount === 0) this.emitirDrain();
    });
    return true;
  }

  /** Atajo para mensajes JSON del protocolo. */
  enviar(mensaje) {
    return this.send(JSON.stringify(mensaje));
  }

  bufferedBytes() {
    return this.#ws.bufferedAmount;
  }

  close(motivo = 'cierre', { reinicio = false } = {}) {
    if (!this.abierta) return;
    const codigo = reinicio ? CodigoCierreWs.REINICIO_SERVICIO : CodigoCierreWs.NORMAL;
    this.#ws.close(codigo, motivo.slice(0, 120));
    this.marcarCerrada(motivo);
  }

  /** Cierra con un código específico (p. ej. 1008 por credenciales). */
  rechazar(codigo, motivo) {
    this.#ws.close(codigo, motivo);
    this.marcarCerrada(motivo);
  }

  /**
   * Latido de protocolo (ping/pong): si no respondió el ping anterior, se termina.
   * @returns {boolean} true si sigue viva
   */
  comprobarVida() {
    if (!this.#viva) {
      this.#ws.terminate();
      this.marcarCerrada('sin-pong');
      return false;
    }
    this.#viva = false;
    this.#ws.ping();
    return true;
  }
}
