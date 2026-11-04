/**
 * Agregado de métricas de todas las instancias para el tablero RT-7.
 * La presentación (gráficas) es de Evelyn; aquí solo se recolecta y suma.
 */
export class OpsService {
  /** @param {{ repositorio: import('./ops.repository.js').OpsRepository, reloj?: () => number }} deps */
  constructor({ repositorio, reloj = Date.now }) {
    this.repositorio = repositorio;
    this.reloj = reloj;
  }

  async agregado() {
    const ts = this.reloj();
    const instancias = (await this.repositorio.instanciasVivas(ts)).sort((a, b) =>
      a.instancia.localeCompare(b.instancia, 'es', { numeric: true }),
    );
    return { ts, instancias, totales: sumarTotales(instancias) };
  }
}

/** Suma conexiones y tasas de contadores; el peor retraso del Event Loop. */
function sumarTotales(instancias) {
  const totales = {
    instancias: instancias.length,
    conexiones: { sse: 0, ws: 0 },
    porSeg: {},
    total: {},
    eventLoopP99MaxMs: 0,
  };
  for (const { gauges = {}, contadores = {} } of instancias) {
    totales.conexiones.sse += gauges.conexiones?.sse ?? 0;
    totales.conexiones.ws += gauges.conexiones?.ws ?? 0;
    totales.eventLoopP99MaxMs = Math.max(totales.eventLoopP99MaxMs, gauges.event_loop_ms?.p99 ?? 0);
    for (const [nombre, { porSeg, total }] of Object.entries(contadores)) {
      totales.porSeg[nombre] = +((totales.porSeg[nombre] ?? 0) + porSeg).toFixed(2);
      totales.total[nombre] = (totales.total[nombre] ?? 0) + (total ?? 0);
    }
  }
  return totales;
}
