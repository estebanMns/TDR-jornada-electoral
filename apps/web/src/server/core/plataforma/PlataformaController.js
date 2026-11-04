import { json } from '../http/ManejadorHttp.js';

/** `GET /api/whoami` y `GET /api/health` (GENERAL §7.1, RT-1, RF-10). */
export class PlataformaController {
  /**
   * @param {{ instancia: string, redis: import('../redis/RedisGateway.js').RedisGateway,
   *           http: import('../http/ManejadorHttp.js').ManejadorHttp }} deps
   */
  constructor({ instancia, redis, http }) {
    this.whoami = http.ruta([], async () => json({ instancia, redis: redis.estado() }));

    this.health = http.ruta([], async () => {
      const ok = redis.disponible();
      return json({ instancia, redis: redis.estado() }, { status: ok ? 200 : 503 });
    });
  }
}
