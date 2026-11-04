import { EventEmitter } from 'node:events';

let secuencia = 0;

/**
 * Adaptador común para conexiones de larga duración (patrón Adapter, GENERAL §3.2).
 * El fan-out no sabe si debajo hay SSE o WebSocket: solo usa esta interfaz.
 *
 * Subclases implementan: `send`, `bufferedBytes`, `close`.
 * @abstract
 */
export class ClientConnection {
  #emisor = new EventEmitter();
  #abierta = true;

  /** @param {'sse'|'ws'} tipo */
  constructor(tipo) {
    if (new.target === ClientConnection) throw new TypeError('ClientConnection es abstracta');
    this.tipo = tipo;
    this.id = `${tipo}-${++secuencia}`;
    this.abiertaDesde = Date.now();
  }

  get abierta() {
    return this.#abierta;
  }

  /**
   * Envía un texto ya serializado (se serializa una vez por lote, no por cliente).
   * @param {string} _texto
   * @returns {boolean} false si el buffer del socket está por encima de su marca de agua
   */
  send(_texto) {
    throw new Error('no implementado');
  }

  /** Bytes pendientes de escribir al socket (para contrapresión, RF-9). */
  bufferedBytes() {
    throw new Error('no implementado');
  }

  /**
   * Cierra la conexión indicando el motivo al cliente.
   * @param {string} _motivo
   * @param {{ reinicio?: boolean }} [_opciones] reinicio = apagado ordenado de la instancia
   */
  close(_motivo, _opciones) {
    throw new Error('no implementado');
  }

  /** @param {() => void} cb se llama cuando el buffer se vacía */
  onDrain(cb) {
    this.#emisor.on('drain', cb);
    return () => this.#emisor.off('drain', cb);
  }

  /** @param {(motivo?: string) => void} cb */
  onClose(cb) {
    if (!this.#abierta) {
      queueMicrotask(() => cb());
      return () => {};
    }
    this.#emisor.once('close', cb);
    return () => this.#emisor.off('close', cb);
  }

  /** @protected */
  emitirDrain() {
    this.#emisor.emit('drain');
  }

  /** @protected */
  marcarCerrada(motivo) {
    if (!this.#abierta) return;
    this.#abierta = false;
    this.#emisor.emit('close', motivo);
    this.#emisor.removeAllListeners();
  }
}
