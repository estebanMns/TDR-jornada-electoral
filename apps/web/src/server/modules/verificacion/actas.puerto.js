/**
 * Puerto hacia el módulo de actas de Jose (GENERAL §7.5).
 *
 * @typedef {{ acta: string, version: number, votos: Record<string, number>|null,
 *             sufragantes?: number, decision: string, auditor: string, fencing: number,
 *             motivo?: string }} Resolucion
 * @typedef {{ aplicarResolucion(resolucion: Resolucion): Promise<unknown> }} ActasPuerto
 */

/** Stub con la misma firma mientras Jose no registre `actasService`. */
export class ActasServiceStub {
  constructor({ logger }) {
    this.logger = logger.child({ componente: 'actas-stub' });
  }

  /** @param {Resolucion} resolucion */
  async aplicarResolucion(resolucion) {
    this.logger.info(
      { resolucion },
      'STUB aplicarResolucion (reemplazar por ActasService de Jose)',
    );
    return { ok: true };
  }
}

/**
 * Resuelve el servicio real en el momento de la llamada: así no importa el
 * orden en que se registren los módulos. Jose registra `actasService` en el contenedor.
 * @implements {ActasPuerto}
 */
export class ActasPuertoPerezoso {
  /** @param {{ contenedor: import('../../core/Contenedor.js').Contenedor, respaldo: ActasPuerto }} deps */
  constructor({ contenedor, respaldo }) {
    this.contenedor = contenedor;
    this.respaldo = respaldo;
  }

  aplicarResolucion(resolucion) {
    const real = this.contenedor.tiene('actasService')
      ? this.contenedor.obtener('actasService')
      : this.respaldo;
    return real.aplicarResolucion(resolucion);
  }
}
