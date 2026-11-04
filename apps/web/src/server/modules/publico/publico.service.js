import { setImmediate as immediate } from 'node:timers/promises';
import { SseConnection } from '../../core/transport/SseConnection.js';
import { TopicRegistry } from './topic-registry.js';
import { BackpressurePolicy } from './backpressure-policy.js';

const WINDOW_MS = Number(process.env.WINDOW_MS) || 2000;
const BATCH_SIZE = 500;
const MAX_PENDING = 2000;
const MAX_AGE_MS = 10 * 60 * 1000;

function fieldsToObject(fields) {
  const out = {};
  for (let i = 0; i < fields.length; i += 2) out[fields[i]] = fields[i + 1];
  return out;
}
function parseEntry([id, fields]) {
  const row = fieldsToObject(fields);
  let abs = {}, motivos = [];
  try { abs = JSON.parse(row.abs ?? '{}'); } catch {}
  try { motivos = JSON.parse(row.motivos ?? '[]'); } catch {}
  return { id, topic: row.topic, abs, motivos: Array.isArray(motivos) ? motivos : [motivos], ts_rx: Number(row.ts_rx) || Date.now() };
}
function compareId(a = '0-0', b = '0-0') {
  const [at, as] = a.split('-').map(Number), [bt, bs] = b.split('-').map(Number);
  return at === bt ? as - bs : at - bt;
}

export class PublicoService {
  constructor({ repository, logger, metrics }) {
    Object.assign(this, { repository, logger, metrics });
    this.registry = new TopicRegistry();
    this.pending = new Map();
    this.cursor = '$';
    this.running = false;
    this.stats = { reales: 0, ingenuos: 0, eventos: 0 };
    this.backpressure = new BackpressurePolicy({ repository, metrics });
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.reader = this.#readLoop();
    this.window = this.#windowLoop();
  }
  async stop() { this.running = false; await Promise.allSettled([this.reader, this.window]); }

  subscribe(topicList, conn) {
    for (const topic of topicList) this.registry.add(topic, conn);
    conn.onClose(() => this.registry.removeConnection(conn));
  }

  async initial(topic, lastId) {
    if (!lastId) return this.repository.snapshot(topic);
    const first = await this.repository.primero();
    const replay = await this.repository.replay(lastId, MAX_PENDING + 1);
    const tooOld = Date.now() - Number(lastId.split('-')[0]) > MAX_AGE_MS;
    if (!first || compareId(lastId, first) < 0 || replay.length > MAX_PENDING || tooOld) {
      return this.repository.snapshot(topic);
    }
    const abs = {};
    const motivos = [];
    let last = lastId;
    for (const raw of replay) {
      const item = parseEntry(raw);
      last = item.id;
      if (item.topic !== topic) continue;
      Object.assign(abs, item.abs);
      motivos.push(...item.motivos);
    }
    return { topic, abs, motivos, lastId: last, continuidad: true };
  }

  async enviarInicial(conn, topic, lastId) {
    const state = await this.initial(topic, lastId);
    conn.send(SseConnection.formatear({
      id: state.lastId,
      evento: state.continuidad ? 'delta' : 'snapshot',
      datos: state,
    }));
    conn.lastId = state.lastId ?? lastId ?? '0-0';
  }

  async #readLoop() {
    while (this.running) {
      try {
        const rows = await this.repository.leer(this.cursor);
        for (const raw of rows) {
          const event = parseEntry(raw);
          this.cursor = event.id;
          if (!event.topic) continue;
          const current = this.pending.get(event.topic) ?? {
            cambios: {}, motivos: [], hastaId: event.id, tsRxMin: event.ts_rx, eventos: 0,
          };
          Object.assign(current.cambios, event.abs);
          current.motivos.push(...event.motivos);
          current.hastaId = event.id;
          current.tsRxMin = Math.min(current.tsRxMin, event.ts_rx);
          current.eventos++;
          this.pending.set(event.topic, current);
        }
      } catch (error) {
        this.logger.warn({ err: error }, 'Error leyendo ev:all');
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  async #windowLoop() {
    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, WINDOW_MS));
      await this.flush();
    }
  }

  async flush() {
    for (const [topic, change] of this.pending) {
      this.pending.delete(topic);
      const targets = [...this.registry.subscribers(topic)];
      this.stats.eventos += change.eventos;
      this.stats.ingenuos += change.eventos * targets.length;
      if (!targets.length) continue;
      const text = SseConnection.formatear({
        id: change.hastaId,
        evento: 'delta',
        datos: { topic, abs: change.cambios, motivos: [...new Set(change.motivos)], ts_rx: change.tsRxMin, hastaId: change.hastaId },
      });
      for (let i = 0; i < targets.length; i += BATCH_SIZE) {
        for (const conn of targets.slice(i, i + BATCH_SIZE)) {
          if (compareId(conn.lastId, change.hastaId) >= 0) continue;
          if (this.backpressure.enviar(conn, topic, text, change.hastaId)) this.stats.reales++;
        }
        if (i + BATCH_SIZE < targets.length) await immediate();
      }
      this.metrics?.inc('publico_eventos_fanout', targets.length);
    }
  }

  redisStateChanged(state) {
    const paused = state === 'degradado';
    const texto = SseConnection.formatear({ evento: 'estado', datos: { pausado: paused, desde: paused ? Date.now() : null } });
    for (const topic of Object.keys(this.registry.counts())) {
      for (const conn of this.registry.subscribers(topic)) conn.send(texto);
    }
  }

  metricas() {
    return { ...this.stats, conexionesPorTopico: this.registry.counts(), atrasados: this.metrics?.valor?.('publico_clientes_atrasados') ?? 0 };
  }
}
