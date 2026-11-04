import { fileURLToPath } from 'node:url';
import { redisKeys } from '@preconteo/shared';
import { LEASE } from '@preconteo/shared/schemas/verificacion';
import { cargarScriptsLua } from '../../core/redis/cargarScriptsLua.js';

const { verificacion: K, bloqueo: B } = redisKeys;

const SCRIPTS = cargarScriptsLua(fileURLToPath(new URL('./lua', import.meta.url)), {
  verifTomar: { archivo: 'tomar.lua', numeroClaves: 4 },
  verifRenovar: { archivo: 'renovar.lua', numeroClaves: 2 },
  verifLiberar: { archivo: 'liberar.lua', numeroClaves: 3 },
  verifResolver: { archivo: 'resolver.lua', numeroClaves: 4 },
  verifReaper: { archivo: 'reaper.lua', numeroClaves: 2 },
});

const valorLock = (sub, token) => `${sub}:${token}`;

/**
 * Único lugar que conoce las claves de verificación en Redis.
 * Todas las transiciones de estado del lease son scripts Lua atómicos.
 */
export class VerificacionRepository {
  /**
   * @param {{ redis: import('../../core/redis/RedisGateway.js').RedisGateway, ttlMs?: number }} deps
   */
  constructor({ redis, ttlMs = LEASE.TTL_MS }) {
    this.redis = redis;
    this.ttlMs = ttlMs;
    redis.definirScripts(SCRIPTS);
  }

  /**
   * @returns {Promise<{ ok: true, fencing: number } | { ok: false, codigo: 'YA_TOMADO'|'NO_EXISTE' }>}
   */
  async tomar({ acta, auditor, token, ahora }) {
    const [ok, dato] = await this.redis.ejecutar((r) =>
      r.verifTomar(
        K.cola,
        K.tomados,
        B.secuenciaFencing,
        B.acta(acta),
        acta,
        auditor.sub,
        token,
        this.ttlMs,
        auditor.nombre,
        ahora,
      ),
    );
    return ok === 1 ? { ok: true, fencing: Number(dato) } : { ok: false, codigo: dato };
  }

  /** @returns {Promise<number|null>} `desde` del caso si se renovó; null si el lock ya no es suyo */
  async renovar({ acta, sub, token }) {
    const desde = await this.redis.ejecutar((r) =>
      r.verifRenovar(B.acta(acta), K.tomados, valorLock(sub, token), this.ttlMs, acta),
    );
    return desde === null ? null : Number(desde);
  }

  /** @returns {Promise<boolean>} */
  async soltar({ acta, sub, token }) {
    const liberado = await this.redis.ejecutar((r) =>
      r.verifLiberar(B.acta(acta), K.tomados, K.cola, valorLock(sub, token), acta),
    );
    return liberado === 1;
  }

  /** @returns {Promise<{ ok: true, fencing: number, score: string } | { ok: false, codigo: 'LOCK_PERDIDO' }>} */
  async resolver({ acta, sub, token }) {
    const [ok, fencingOCodigo, score] = await this.redis.ejecutar((r) =>
      r.verifResolver(
        B.acta(acta),
        K.tomados,
        K.caso(acta),
        K.estadisticas,
        valorLock(sub, token),
        acta,
      ),
    );
    return ok === 1
      ? { ok: true, fencing: Number(fencingOCodigo), score }
      : { ok: false, codigo: fencingOCodigo };
  }

  /** Compensación si la aplicación de la resolución falla: el caso vuelve tal cual estaba. */
  async reencolar(caso, score) {
    await this.redis.ejecutar((r) =>
      r
        .multi()
        .set(K.caso(caso.acta), JSON.stringify(caso))
        .zadd(K.cola, score, caso.acta)
        .hincrby(K.estadisticas, 'resueltos', -1)
        .exec(),
    );
  }

  /** @returns {Promise<string[]>} actas devueltas a la cola por lease expirado */
  liberarExpirados() {
    return this.redis.ejecutar((r) => r.verifReaper(K.tomados, K.cola, B.prefijoActa));
  }

  async leerCaso(acta) {
    const texto = await this.redis.ejecutar((r) => r.get(K.caso(acta)));
    return texto ? JSON.parse(texto) : null;
  }

  /**
   * Fotografía completa de la cola: pendientes + tomados + contadores.
   * La cola es pequeña (decenas/cientos), así que se envía entera al conectar.
   */
  async estadoCola() {
    const [[, cola], [, tomados], [, resueltos]] = await this.redis.ejecutar((r) =>
      r
        .multi()
        .zrange(K.cola, 0, -1, 'WITHSCORES')
        .hgetall(K.tomados)
        .hget(K.estadisticas, 'resueltos')
        .exec(),
    );

    const pendientes = [];
    for (let i = 0; i < cola.length; i += 2)
      pendientes.push({ acta: cola[i], score: Number(cola[i + 1]) });
    const enCurso = Object.entries(tomados).map(([acta, json]) => {
      const t = JSON.parse(json);
      return {
        acta,
        score: Number(t.score),
        tomadoPor: { sub: t.auditor, nombre: t.nombre, desde: Number(t.desde) },
      };
    });

    const todos = [...pendientes, ...enCurso];
    const casos = todos.length
      ? await this.redis.ejecutar((r) => r.mget(todos.map((t) => K.caso(t.acta))))
      : [];

    const items = todos
      .map((t, i) =>
        casos[i]
          ? { ...JSON.parse(casos[i]), score: t.score, tomadoPor: t.tomadoPor ?? null }
          : null,
      )
      .filter(Boolean)
      .sort((a, b) => a.score - b.score);

    return {
      items,
      contadores: {
        pendientes: pendientes.length,
        enCurso: enCurso.length,
        resueltos: Number(resueltos ?? 0),
      },
    };
  }
}
