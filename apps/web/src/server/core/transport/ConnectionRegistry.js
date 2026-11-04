/**
 * Todas las conexiones abiertas en esta instancia (lo único que vive en memoria, RT-2).
 * Sirve para métricas y para el apagado ordenado.
 */
export class ConnectionRegistry {
  /** @type {Set<import('./ClientConnection.js').ClientConnection>} */
  #conexiones = new Set();

  /** @template {import('./ClientConnection.js').ClientConnection} T @param {T} conexion @returns {T} */
  agregar(conexion) {
    this.#conexiones.add(conexion);
    conexion.onClose(() => this.#conexiones.delete(conexion));
    return conexion;
  }

  contar(tipo) {
    let n = 0;
    for (const c of this.#conexiones) if (!tipo || c.tipo === tipo) n += 1;
    return n;
  }

  /** @param {import('../metrics/MetricsRegistry.js').MetricsRegistry} metrics */
  registrarEn(metrics) {
    metrics.gauge('conexiones', () => ({ sse: this.contar('sse'), ws: this.contar('ws') }));
  }

  /** Cierre por apagado: SSE recibe `reconectar`, WS recibe 1012. */
  cerrarTodas(motivo = 'reinicio') {
    for (const conexion of [...this.#conexiones]) conexion.close(motivo, { reinicio: true });
  }
}
