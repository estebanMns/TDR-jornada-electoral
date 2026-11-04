/**
 * Marca global (Symbol.for) en vez de `instanceof`: Next empaqueta las rutas
 * en otro grafo de módulos, así que la clase puede existir dos veces.
 */
const MARCA = Symbol.for('preconteo.HttpError');

export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} codigo   código estable para el cliente (p. ej. "RATE_LIMIT")
   * @param {string} [mensaje]
   * @param {{ cuerpo?: object, headers?: Record<string,string> }} [extra]
   */
  constructor(status, codigo, mensaje = codigo, { cuerpo = {}, headers = {} } = {}) {
    super(mensaje);
    this.name = 'HttpError';
    this.status = status;
    this.codigo = codigo;
    this.cuerpo = cuerpo;
    this.headers = headers;
    this[MARCA] = true;
  }

  /** @returns {e is HttpError} */
  static es(e) {
    return Boolean(e && e[MARCA]);
  }

  static noAutenticado() {
    return new HttpError(401, 'NO_AUTENTICADO', 'Inicia sesión');
  }

  static prohibido() {
    return new HttpError(403, 'PROHIBIDO', 'Tu rol no tiene acceso');
  }

  static solicitudInvalida(detalle) {
    return new HttpError(400, 'SOLICITUD_INVALIDA', 'Datos inválidos', { cuerpo: { detalle } });
  }

  static noEncontrado(que = 'Recurso') {
    return new HttpError(404, 'NO_ENCONTRADO', `${que} no encontrado`);
  }

  static servicioNoDisponible(codigo = 'SERVICIO_NO_DISPONIBLE') {
    return new HttpError(503, codigo, 'Servicio temporalmente no disponible', {
      headers: { 'Retry-After': '1' },
    });
  }
}
