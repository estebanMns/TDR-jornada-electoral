export class PublicoRepository {
  constructor({ redis, reader }) { this.redis = redis; this.reader = reader; }

  async leer(cursor) {
    // XREAD BLOCK se ejecuta en conexión dedicada para no bloquear comandos normales.
    const result = await this.reader.xread('COUNT', 1000, 'BLOCK', 1000, 'STREAMS', 'ev:all', cursor);
    return result?.[0]?.[1] ?? [];
  }

  async primero() {
    const info = await this.redis.ejecutar((r) => r.xinfo('STREAM', 'ev:all'));
    const field = info.find(([key]) => key === 'first-entry');
    return field?.[1]?.[0] ?? null;
  }

  async replay(id, count = 2001) {
    return this.redis.ejecutar((r) => r.xrange('ev:all', `(${id}`, '+', 'COUNT', count));
  }

  async snapshot(topic) {
    const [totals, informed, lastId] = await this.redis.ejecutar((r) =>
      r.snapshotPublico(`tot:${topic}`, `cat:n:${topic}`, 'ev:all'),
    );
    return {
      topic,
      abs: hashToObject(totals),
      mesasInformadas: Number(informed ?? 0),
      lastId: String(lastId ?? '0-0'),
    };
  }

  async guardarInp(value) {
    await this.redis.ejecutar((r) =>
      r.multi().lpush('vitals:inp', JSON.stringify({ value, ts: Date.now() })).ltrim('vitals:inp', 0, 999).exec(),
    );
  }

  async inpP75() {
    const rows = await this.redis.ejecutar((r) => r.lrange('vitals:inp', 0, -1));
    const values = rows.map((x) => Number(JSON.parse(x).value)).filter(Number.isFinite).sort((a,b) => a-b);
    return values.length ? values[Math.ceil(values.length * .75) - 1] : null;
  }
}
function hashToObject(flat) {
  const out = {};
  for (let i = 0; i < flat.length; i += 2) out[flat[i]] = Number(flat[i + 1]);
  return out;
}
