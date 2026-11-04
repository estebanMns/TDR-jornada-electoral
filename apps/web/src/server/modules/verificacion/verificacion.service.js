import { randomUUID } from 'node:crypto';
import { cuadra } from '@preconteo/shared/reglaContable';
import { Decision, LEASE, MensajeServidor } from '@preconteo/shared/schemas/verificacion';
import { ErrorVerificacion, CodigoErrorVerificacion as Codigo } from './verificacion.errores.js';

/** Resultado de un latido respecto al lease. */
export const Renovacion = Object.freeze({
  SIN_CASO: 'SIN_CASO',
  RENOVADO: 'RENOVADO',
  INACTIVO: 'INACTIVO', // hay socket pero no actividad: no se renueva, expira solo
  LOCK_PERDIDO: 'LOCK_PERDIDO',
});

/**
 * Casos de uso de la verificación colaborativa (RF-7, GENERAL §9.3).
 * No conoce WebSocket ni claves de Redis: recibe repositorios y canal por inyección.
 */
export class VerificacionService {
  /**
   * @param {{
   *   repositorio: import('./verificacion.repository.js').VerificacionRepository,
   *   historial: import('./historial.repository.js').HistorialVerificacionRepository,
   *   actas: import('./actas.puerto.js').ActasPuerto,
   *   canal: import('../../core/redis/CanalRedis.js').CanalRedis,
   *   metrics: import('../../core/metrics/MetricsRegistry.js').MetricsRegistry,
   *   reloj?: () => number,
   *   generarToken?: () => string,
   *   ttlMs?: number,
   *   inactividadMaxMs?: number,
   * }} deps
   */
  constructor({
    repositorio,
    historial,
    actas,
    canal,
    metrics,
    reloj = Date.now,
    generarToken = randomUUID,
    ttlMs = LEASE.TTL_MS,
    inactividadMaxMs = LEASE.INACTIVIDAD_MAX_MS,
  }) {
    Object.assign(this, { repositorio, historial, actas, canal, metrics, reloj, generarToken });
    this.ttlMs = ttlMs;
    this.inactividadMaxMs = inactividadMaxMs;
  }

  estadoCola() {
    return this.repositorio.estadoCola();
  }

  /** @param {{ sub: string, nombre: string }} auditor */
  async tomar(auditor, acta) {
    const token = this.generarToken();
    const ahora = this.reloj();
    const resultado = await this.repositorio.tomar({ acta, auditor, token, ahora });
    if (!resultado.ok) throw new ErrorVerificacion(resultado.codigo, acta);

    this.metrics.inc('verif_tomados');
    await this.canal.publicarSinFallar({
      tipo: MensajeServidor.CASO_TOMADO,
      acta,
      auditor: { sub: auditor.sub, nombre: auditor.nombre, desde: ahora },
    });
    return { acta, token, fencing: resultado.fencing, expiraEn: ahora + this.ttlMs };
  }

  /**
   * Latido del cliente: renueva el lease SOLO si hubo actividad real reciente
   * (tensión expirar vs. seguir trabajando).
   * @param {{ sub: string }} auditor
   * @param {{ actividad: number, inactivoMs?: number, acta?: string, token?: string }} latido
   */
  async latido(auditor, { actividad, inactivoMs, acta, token }) {
    const ahora = this.reloj();
    // `inactivoMs` (relativo) evita el desfase de reloj entre navegador y servidor.
    const inactividad = inactivoMs ?? Math.max(0, ahora - actividad);
    const activo = inactividad < this.inactividadMaxMs;

    if (!acta || !token) return { activo, renovacion: Renovacion.SIN_CASO, caso: null };
    if (!activo) return { activo, renovacion: Renovacion.INACTIVO, caso: { acta, desde: null } };

    const desde = await this.repositorio.renovar({ acta, sub: auditor.sub, token });
    if (desde === null) return { activo, renovacion: Renovacion.LOCK_PERDIDO, caso: null };
    return {
      activo,
      renovacion: Renovacion.RENOVADO,
      caso: { acta, desde },
      expiraEn: ahora + this.ttlMs,
    };
  }

  async soltar(auditor, { acta, token }) {
    const liberado = await this.repositorio.soltar({ acta, sub: auditor.sub, token });
    if (!liberado) throw new ErrorVerificacion(Codigo.LOCK_PERDIDO, acta);
    await this.canal.publicarSinFallar({ tipo: MensajeServidor.CASO_LIBERADO, acta });
  }

  /**
   * Cierra el caso. Orden:
   * 1) validar la decisión (antes de tocar el lock),
   * 2) Lua compare-and-delete con el token (LOCK_PERDIDO si no es suyo),
   * 3) aplicar en actas con el fencing (si falla → compensar y reencolar),
   * 4) persistir en Supabase (fuera del camino crítico) y avisar.
   */
  async resolver(auditor, { acta, token, decision, votos, sufragantes, motivo }) {
    const caso = await this.repositorio.leerCaso(acta);
    if (!caso) throw new ErrorVerificacion(Codigo.NO_EXISTE, acta);
    const resultadoFinal = this.#resultadoFinal(caso, { decision, votos, sufragantes });

    const cierre = await this.repositorio.resolver({ acta, sub: auditor.sub, token });
    if (!cierre.ok) throw new ErrorVerificacion(cierre.codigo, acta);

    const resolucion = {
      acta,
      version: caso.version,
      ...resultadoFinal,
      decision,
      auditor: auditor.sub,
      fencing: cierre.fencing,
      motivo,
    };

    try {
      await this.actas.aplicarResolucion(resolucion);
    } catch (err) {
      await this.repositorio.reencolar(caso, cierre.score);
      await this.canal.publicarSinFallar({ tipo: MensajeServidor.CASO_LIBERADO, acta });
      throw new ErrorVerificacion(Codigo.APLICACION_FALLIDA, acta, { cause: err });
    }

    this.metrics.inc('verif_resueltos');
    await this.historial.registrarDecision({
      acta,
      version: caso.version,
      auditor: auditor.sub,
      decision,
      votosCorregidos: decision === Decision.APROBAR_CON_CORRECCION ? resultadoFinal.votos : null,
      motivo,
      fencing: cierre.fencing,
    });
    await this.canal.publicarSinFallar({ tipo: MensajeServidor.CASO_RESUELTO, acta, decision });
    return { acta, fencing: cierre.fencing };
  }

  /** Reaper: casos con lease vencido vuelven a la cola. Idempotente. */
  async liberarExpirados() {
    const liberadas = await this.repositorio.liberarExpirados();
    for (const acta of liberadas) {
      this.metrics.inc('verif_liberados_por_expiracion');
      await this.canal.publicarSinFallar({
        tipo: MensajeServidor.CASO_LIBERADO,
        acta,
        motivo: 'EXPIRADO',
      });
    }
    return liberadas;
  }

  /**
   * Votos y sufragantes que se aplicarán según la decisión.
   * Aprobar tal cual es criterio del auditor (confirmó contra la foto);
   * una corrección, en cambio, debe cumplir la regla contable.
   */
  #resultadoFinal(caso, { decision, votos, sufragantes }) {
    if (decision === Decision.RECHAZAR) return { votos: null, sufragantes: caso.sufragantes };
    if (decision === Decision.APROBAR) return { votos: caso.votos, sufragantes: caso.sufragantes };
    const sufragantesFinales = sufragantes ?? caso.sufragantes;
    if (!cuadra(votos, sufragantesFinales))
      throw new ErrorVerificacion(Codigo.DESCUADRE, caso.acta);
    return { votos, sufragantes: sufragantesFinales };
  }
}
