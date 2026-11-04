const EV_ALL = 'ev:all';
const VITALS_INP = 'vitals:inp';

/** Campos reservados dentro de `tot:*` (contrato de actas). */
export const CAMPO_INFORMADAS = '_reported';

/** Acceso a Redis del módulo público. Único lugar que conoce sus claves. */
export class PublicoRepository {
  /**
   * @param {{ redis: import('../../core/redis/RedisGateway.js').RedisGateway,
   *           lector: import('ioredis').Redis }} deps
   *        `lector`: conexión dedicada para XREAD BLOCK (no bloquea los comandos normales).
   */
  constructor({ redis, lector }) {
    this.redis = redis;
    this.lector = lector;
  }

  /** Eventos nuevos después de `cursor` ('$' = solo los que lleguen desde ahora). */
  async leer(cursor, { bloquearMs = 1_000, cantidad = 1_000 } = {}) {
    const resultado = await this.lector.xread(
      'COUNT',
      cantidad,
      'BLOCK',
      bloquearMs,
      'STREAMS',
      EV_ALL,
      cursor,
    );
    return resultado?.[0]?.[1] ?? [];
  }

  /** Último id del stream (o '0-0' si está vacío): punto de partida del lector. */
  async ultimoId() {
    const [ultimo] = await this.redis.ejecutar((r) => r.xrevrange(EV_ALL, '+', '-', 'COUNT', 1));
    return ultimo?.[0] ?? '0-0';
  }

  /** Id más antiguo que aún retiene el stream (MAXLEN ~ 50000). */
  async primerId() {
    const [primero] = await this.redis.ejecutar((r) => r.xrange(EV_ALL, '-', '+', 'COUNT', 1));
    return primero?.[0] ?? null;
  }

  /** Eventos posteriores a `id` (exclusivo), como máximo `cantidad`. */
  async desde(id, cantidad) {
    return this.redis.ejecutar((r) => r.xrange(EV_ALL, `(${id}`, '+', 'COUNT', cantidad));
  }

  /**
   * Fotografía consistente de un tópico.
   * @returns {Promise<{ topico: string, totales: Record<string, number>,
   *                     mesas: { informadas: number, total: number }, hastaId: string }>}
   */
  async fotografia(topico) {
    const [plano, mesasTotal, ultimoId] = await this.redis.ejecutar((r) =>
      r.snapshotPublico(`tot:${topico}`, `cat:n:${topico}`, EV_ALL),
    );
    const totales = {};
    for (let i = 0; i < plano.length; i += 2) totales[plano[i]] = Number(plano[i + 1]);
    return {
      topico,
      totales,
      mesas: { informadas: totales[CAMPO_INFORMADAS] ?? 0, total: Number(mesasTotal) || 0 },
      hastaId: String(ultimoId),
    };
  }

  async guardarInp(valorMs) {
    await this.redis.ejecutar((r) =>
      r
        .multi()
        .lpush(VITALS_INP, JSON.stringify({ valor: valorMs, ts: Date.now() }))
        .ltrim(VITALS_INP, 0, 999)
        .exec(),
    );
  }

  /** p75 de las últimas 1000 muestras de INP (lo que reporta web-vitals). */
  async inpP75() {
    const filas = await this.redis.ejecutar((r) => r.lrange(VITALS_INP, 0, -1));
    const valores = filas
      .map((fila) => Number(JSON.parse(fila).valor))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    return valores.length ? valores[Math.ceil(valores.length * 0.75) - 1] : null;
  }

  /** Memoria que ocupa el historial (para el informe de RF-6). */
  async memoriaHistorial() {
    return this.redis.ejecutar((r) => r.call('MEMORY', 'USAGE', EV_ALL));
  }
}
