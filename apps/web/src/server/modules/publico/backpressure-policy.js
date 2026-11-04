import { SseConnection } from '../../core/transport/SseConnection.js';

/** Strategy RF-9: no delta while congested; snapshot on drain; disconnect at hard limit. */
export class BackpressurePolicy {
  constructor({ repository, metrics, highWater = 64 * 1024, hardLimit = 512 * 1024, maxDelayMs = 30_000 }) {
    Object.assign(this, { repository, metrics, highWater, hardLimit, maxDelayMs });
  }

  enviar(conn, topic, texto, lastId) {
    if (!conn.abierta) return false;
    const bytes = conn.bufferedBytes();
    if (bytes > this.hardLimit || (conn.atrasadaDesde && Date.now() - conn.atrasadaDesde > this.maxDelayMs)) {
      conn.send(SseConnection.formatear({ evento: 'reconectar', datos: { motivo: 'cliente_lento' } }));
      conn.close('cliente_lento');
      this.metrics?.inc('publico_clientes_desconectados');
      return false;
    }
    if (bytes > this.highWater || conn.atrasadaDesde) {
      if (!conn.atrasadaDesde) {
        conn.atrasadaDesde = Date.now();
        this.metrics?.inc('publico_clientes_atrasados');
        const quitar = conn.onDrain(async () => {
          quitar();
          if (!conn.abierta) return;
          try {
            const snapshot = await this.repository.snapshot(topic);
            conn.send(SseConnection.formatear({ id: snapshot.lastId, evento: 'snapshot', datos: snapshot }));
            conn.lastId = snapshot.lastId ?? lastId;
            conn.atrasadaDesde = null;
          } catch {
            conn.close('snapshot_no_disponible');
          }
        });
      }
      return false;
    }
    conn.send(texto);
    conn.lastId = lastId;
    return true;
  }
}
