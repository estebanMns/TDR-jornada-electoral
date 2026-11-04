import { SignJWT, jwtVerify } from 'jose';
import { jwtPayloadSchema } from '@preconteo/shared/schemas/auth';

/**
 * Emite y valida JWT HS256 (GENERAL §4). Sin estado: cualquier instancia valida
 * el token de cualquier otra (RT-2). Sin dependencias de Node: también lo usa `proxy.js`.
 */
export class TokenService {
  #clave;
  #expiracion;

  /** @param {{ secreto: string, expiracion?: string }} config */
  constructor({ secreto, expiracion = '8h' }) {
    this.#clave = new TextEncoder().encode(secreto);
    this.#expiracion = expiracion;
  }

  /** @param {{ sub: string, rol: string, nombre: string, mesa?: number|null }} usuario */
  firmar({ sub, rol, nombre, mesa = null }) {
    return new SignJWT({ rol, nombre, mesa })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime(this.#expiracion)
      .sign(this.#clave);
  }

  /**
   * @param {string} token
   * @returns {Promise<import('zod').infer<typeof jwtPayloadSchema> | null>} null si no es válido
   */
  async verificar(token) {
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.#clave, { algorithms: ['HS256'] });
      const resultado = jwtPayloadSchema.safeParse(payload);
      return resultado.success ? resultado.data : null;
    } catch {
      return null;
    }
  }
}
