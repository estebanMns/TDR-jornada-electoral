import { HttpError } from '../errors/HttpError.js';
import { RedisNoDisponibleError } from '../errors/RedisNoDisponibleError.js';

/** Respuesta JSON con cabeceras opcionales. */
export function json(cuerpo, { status = 200, headers = {} } = {}) {
  return Response.json(cuerpo, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

/**
 * Guardia: función que valida/enriquece la petición antes del manejador.
 * Lanza un HttpError para cortar la cadena (Chain of Responsibility).
 * @typedef {(request: Request, contexto: Record<string, any>) => Promise<void>|void} Guardia
 */

/**
 * Construye manejadores de rutas Next: aplica guardias en orden y traduce
 * errores a respuestas HTTP consistentes. Las rutas quedan sin lógica transversal.
 */
export class ManejadorHttp {
  /** @param {{ logger: import('pino').Logger }} deps */
  constructor({ logger }) {
    this.logger = logger.child({ componente: 'http' });
  }

  /**
   * @param {Guardia[]} guardias
   * @param {(request: Request, contexto: Record<string, any>) => Promise<Response>} manejador
   */
  ruta(guardias, manejador) {
    return async (request, contextoNext = {}) => {
      const contexto = { params: await contextoNext.params };
      try {
        for (const guardia of guardias) await guardia(request, contexto);
        return await manejador(request, contexto);
      } catch (err) {
        return this.#respuestaDeError(err, request);
      }
    };
  }

  /** Valida un cuerpo JSON con un esquema zod o lanza 400. */
  async leerJson(request, esquema) {
    let cuerpo;
    try {
      cuerpo = await request.json();
    } catch {
      throw HttpError.solicitudInvalida('El cuerpo no es JSON');
    }
    const resultado = esquema.safeParse(cuerpo);
    if (!resultado.success) throw HttpError.solicitudInvalida(resultado.error.issues);
    return resultado.data;
  }

  #respuestaDeError(err, request) {
    if (HttpError.es(err)) {
      return json(
        { error: err.codigo, mensaje: err.message, ...err.cuerpo },
        { status: err.status, headers: err.headers },
      );
    }
    if (RedisNoDisponibleError.es(err)) {
      return json(
        { error: 'REDIS_NO_DISPONIBLE', mensaje: 'Servicio degradado, reintenta' },
        { status: 503, headers: { 'Retry-After': '1' } },
      );
    }
    this.logger.error({ err, url: request.url }, 'error no controlado');
    return json({ error: 'ERROR_INTERNO', mensaje: 'Error interno' }, { status: 500 });
  }
}
