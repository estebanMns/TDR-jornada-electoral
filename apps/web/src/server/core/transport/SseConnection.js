import { ClientConnection } from './ClientConnection.js';

/**
 * Conexión Server-Sent Events sobre la respuesta cruda de Node.
 * Se usa `res` directamente (no un ReadableStream de Next) porque la
 * contrapresión necesita `writableLength` y el evento `drain`.
 */
export class SseConnection extends ClientConnection {
  #res;

  /**
   * @param {import('node:http').ServerResponse} res
   * @param {{ retryMs?: number, headers?: Record<string,string> }} [opciones]
   */
  constructor(res, { retryMs = 3_000, headers = {} } = {}) {
    super('sse');
    this.#res = res;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...headers,
    });
    res.flushHeaders();
    res.socket?.setNoDelay(true);
    res.on('drain', () => this.emitirDrain());
    res.on('close', () => this.marcarCerrada('cliente'));
    this.send(`retry: ${retryMs}\n\n`);
  }

  /**
   * Formatea un evento SSE. Se llama una vez por lote y el texto se reutiliza.
   * @param {{ id?: string, evento?: string, datos: unknown }} evento
   */
  static formatear({ id, evento, datos }) {
    const lineas = [];
    if (id) lineas.push(`id: ${id}`);
    if (evento) lineas.push(`event: ${evento}`);
    const texto = typeof datos === 'string' ? datos : JSON.stringify(datos);
    for (const linea of texto.split('\n')) lineas.push(`data: ${linea}`);
    return `${lineas.join('\n')}\n\n`;
  }

  send(texto) {
    if (!this.abierta) return false;
    return this.#res.write(texto);
  }

  /** Comentario SSE para mantener viva la conexión a través de proxies. */
  comentario(texto = 'ping') {
    return this.send(`: ${texto}\n\n`);
  }

  bufferedBytes() {
    return this.#res.writableLength;
  }

  close(motivo = 'cierre', _opciones = {}) {
    if (!this.abierta) return;
    this.#res.end(SseConnection.formatear({ evento: 'reconectar', datos: { motivo } }));
    this.marcarCerrada(motivo);
  }
}
