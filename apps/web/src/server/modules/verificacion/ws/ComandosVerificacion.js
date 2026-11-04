import { MensajeServidor as M } from '@preconteo/shared/schemas/verificacion';
import { Renovacion } from '../verificacion.service.js';
import { CodigoErrorVerificacion as Codigo } from '../verificacion.errores.js';

/**
 * Un método por tipo de mensaje cliente → servidor (patrón Command).
 * Agregar un mensaje nuevo = agregar un método; el gateway no cambia (Open/Closed).
 */
export class ComandosVerificacion {
  /**
   * @param {{ servicio: import('../verificacion.service.js').VerificacionService,
   *           presencia: import('../presencia.service.js').PresenciaService }} deps
   */
  constructor({ servicio, presencia }) {
    this.servicio = servicio;
    this.presencia = presencia;
  }

  /** @param {import('./SesionVerificacion.js').SesionVerificacion} sesion */
  async hola(sesion) {
    sesion.enviar({ tipo: M.ESTADO_COLA, ...(await this.servicio.estadoCola()) });
  }

  async tomar(sesion, { acta }) {
    const tomado = await this.servicio.tomar(sesion.usuario, acta);
    sesion.enviar({ tipo: M.TOMADO_OK, ...tomado });
  }

  async latido(sesion, mensaje) {
    const resultado = await this.servicio.latido(sesion.usuario, mensaje);

    if (resultado.renovacion === Renovacion.RENOVADO) {
      sesion.enviar({ tipo: M.LOCK_RENOVADO, acta: mensaje.acta, expiraEn: resultado.expiraEn });
    } else if (resultado.renovacion === Renovacion.LOCK_PERDIDO) {
      sesion.enviar({ tipo: M.ERROR, codigo: Codigo.LOCK_PERDIDO, acta: mensaje.acta });
    }

    await this.presencia.latido(sesion.usuario, {
      caso: resultado.caso,
      activo: resultado.activo,
      conectadoDesde: sesion.conectadoDesde,
    });
  }

  async resolver(sesion, mensaje) {
    await this.servicio.resolver(sesion.usuario, mensaje);
  }

  async soltar(sesion, mensaje) {
    await this.servicio.soltar(sesion.usuario, mensaje);
  }
}
