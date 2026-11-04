import { redisKeys } from '@preconteo/shared';
import { HttpError } from '../errors/HttpError.js';

/**
 * Límite de tasa de ventana fija compartido entre instancias (GENERAL §7.1, §8).
 * `rl:{credencial}:{ventana}` con INCR + EXPIRE NX en una transacción.
 */
export class RateLimiter {
  /** @param {{ redis: import('../redis/RedisGateway.js').RedisGateway, reloj?: () => number }} deps */
  constructor({ redis, reloj = Date.now }) {
    this.redis = redis;
    this.reloj = reloj;
  }

  /**
   * @param {{ clave: string, limite: number, ventanaSeg: number }} regla
   * @returns {Promise<{ permitido: boolean, restantes: number, reintentarEn: number }>}
   */
  async consumir({ clave, limite, ventanaSeg }) {
    const ahoraSeg = Math.floor(this.reloj() / 1000);
    const ventana = Math.floor(ahoraSeg / ventanaSeg);
    const llave = redisKeys.limiteTasa.contador(clave, ventana);

    const [[, usados]] = await this.redis.ejecutar((r) =>
      r.multi().incr(llave).expire(llave, ventanaSeg, 'NX').exec(),
    );
    const reintentarEn = (ventana + 1) * ventanaSeg - ahoraSeg;
    return { permitido: usados <= limite, restantes: Math.max(0, limite - usados), reintentarEn };
  }

  /**
   * Guardia HTTP: `rateLimit({ clave: (req, ctx) => ..., limite, ventanaSeg })`.
   * Exceso → 429 con `Retry-After` y `{ error: "RATE_LIMIT", reintentarEn }`.
   * @param {{ clave: (request: Request, contexto: object) => string, limite: number, ventanaSeg: number }} regla
   */
  rateLimit({ clave, limite, ventanaSeg }) {
    return async (request, contexto) => {
      const { permitido, reintentarEn } = await this.consumir({
        clave: clave(request, contexto),
        limite,
        ventanaSeg,
      });
      if (!permitido) {
        throw new HttpError(429, 'RATE_LIMIT', 'Demasiadas solicitudes', {
          cuerpo: { reintentarEn },
          headers: { 'Retry-After': String(reintentarEn) },
        });
      }
    };
  }
}
