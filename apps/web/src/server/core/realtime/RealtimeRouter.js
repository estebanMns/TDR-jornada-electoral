import { STATUS_CODES } from 'node:http';
import { WebSocketServer } from 'ws';
import { HttpError } from '../errors/HttpError.js';

/**
 * @typedef {{
 *   autenticar: (req: import('node:http').IncomingMessage) => Promise<unknown>,
 *   conectar: (ws: import('ws').WebSocket, req: import('node:http').IncomingMessage, contexto: any) => void,
 * }} RutaWs
 */

/**
 * Enrutador de las rutas de tiempo real que NO pasan por Next:
 * - SSE: necesitan el `ServerResponse` crudo (contrapresión con `writableLength`/`drain`).
 * - WebSocket: Next no maneja `upgrade`; se atiende aquí con `ws`.
 * Lo demás (páginas y API JSON) sigue a Next.
 */
export class RealtimeRouter {
  /** @type {Map<string, (req, res, url: URL) => unknown>} */
  #rutasHttp = new Map();
  /** @type {Map<string, RutaWs>} */
  #rutasWs = new Map();
  #wss;

  /** @param {{ instancia: string, logger: import('pino').Logger }} deps */
  constructor({ instancia, logger }) {
    this.logger = logger.child({ componente: 'realtime' });
    this.#wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
    this.#wss.on('headers', (headers) => headers.push(`X-Instance: ${instancia}`));
  }

  /** @param {string} ruta @param {(req, res, url: URL) => unknown} manejador */
  http(ruta, manejador) {
    this.#rutasHttp.set(ruta, manejador);
  }

  /**
   * La autenticación ocurre ANTES del upgrade: un cliente sin permiso recibe
   * 401/403 HTTP y nunca abre el socket.
   * @param {string} ruta @param {RutaWs} definicion
   */
  ws(ruta, definicion) {
    this.#rutasWs.set(ruta, definicion);
  }

  /** @returns {boolean} true si la ruta la atendió este enrutador */
  manejarHttp(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const manejador = this.#rutasHttp.get(url.pathname);
    if (!manejador) return false;
    Promise.resolve()
      .then(() => manejador(req, res, url))
      .catch((err) => this.#responderError(res, err, url.pathname));
    return true;
  }

  /** @returns {boolean} true si la ruta la atendió este enrutador */
  manejarUpgrade(req, socket, head) {
    const { pathname } = new URL(req.url, 'http://localhost');
    const ruta = this.#rutasWs.get(pathname);
    if (!ruta) return false;
    Promise.resolve()
      .then(() => ruta.autenticar(req))
      .then((contexto) => {
        if (socket.destroyed) return;
        this.#wss.handleUpgrade(req, socket, head, (ws) => ruta.conectar(ws, req, contexto));
      })
      .catch((err) => {
        const status = HttpError.es(err) ? err.status : 500;
        if (status === 500) this.logger.error({ err, ruta: pathname }, 'error en upgrade');
        socket.end(
          `HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
        );
      });
    return true;
  }

  cerrar() {
    this.#wss.close();
  }

  #responderError(res, err, ruta) {
    const esHttp = HttpError.es(err);
    if (!esHttp) this.logger.error({ err, ruta }, 'error en ruta de tiempo real');
    if (res.headersSent) return res.end();
    const status = esHttp ? err.status : 500;
    const codigo = esHttp ? err.codigo : 'ERROR_INTERNO';
    res.writeHead(status, { 'Content-Type': 'application/json', ...(esHttp ? err.headers : {}) });
    res.end(JSON.stringify({ error: codigo }));
  }
}
