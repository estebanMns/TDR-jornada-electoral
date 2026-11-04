/**
 * Política explícita para clientes lentos (RF-9, patrón Strategy).
 *
 * Antes de cada envío se mira cuánto tiene pendiente el socket:
 * - `> umbralBytes` (64 KB): se deja de enviar el detalle y la conexión queda
 *   "atrasada". Cuando su búfer se vacía (`drain`) recibe una FOTOGRAFÍA del
 *   estado actual en vez de todos los deltas que se perdió.
 * - `> limiteBytes` (512 KB) o atrasada más de `maxAtrasoMs` (30 s): se cierra
 *   con `event: reconectar`; el cliente vuelve con su `Last-Event-ID` (RF-6).
 * Así la memoria por conexión queda acotada aunque el cliente no lea.
 */
export class BackpressurePolicy {
  /** Lo asigna el servicio: qué hacer cuando un cliente atrasado se pone al día. */
  alDrenar = async () => {};

  /**
   * @param {{ metrics: import('../../core/metrics/MetricsRegistry.js').MetricsRegistry,
   *           umbralBytes?: number, limiteBytes?: number, maxAtrasoMs?: number, reloj?: () => number }} deps
   */
  constructor({
    metrics,
    umbralBytes = 64 * 1024,
    limiteBytes = 512 * 1024,
    maxAtrasoMs = 30_000,
    reloj = Date.now,
  }) {
    Object.assign(this, { metrics, umbralBytes, limiteBytes, maxAtrasoMs, reloj });
  }

  /**
   * @param {import('../../core/transport/ClientConnection.js').ClientConnection & { publico: any }} conexion
   * @param {string} texto mensaje ya serializado
   * @returns {boolean} true si se envió
   */
  enviar(conexion, texto) {
    const estado = conexion.publico;
    const pendientes = conexion.bufferedBytes();
    const atrasoMs = estado.atrasadaDesde ? this.reloj() - estado.atrasadaDesde : 0;

    if (pendientes > this.limiteBytes || atrasoMs > this.maxAtrasoMs) {
      conexion.close('cliente_lento'); // SseConnection envía `event: reconectar`
      this.metrics.inc('publico_clientes_desconectados');
      return false;
    }
    if (estado.atrasadaDesde) return false; // esperando `drain`
    if (pendientes > this.umbralBytes) {
      estado.atrasadaDesde = this.reloj();
      this.metrics.inc('publico_clientes_atrasados');
      const quitar = conexion.onDrain(() => {
        quitar();
        if (!conexion.abierta) return;
        estado.atrasadaDesde = null;
        this.alDrenar(conexion).catch(() => conexion.close('fotografia_no_disponible'));
      });
      return false;
    }
    conexion.send(texto);
    return true;
  }
}
