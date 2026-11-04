import { OpsRepository } from './ops.repository.js';
import { OpsService } from './ops.service.js';
import { OpsStream } from './ops.stream.js';

/**
 * Recolección de métricas de operación (RT-7). Dueño: Meneses (UI: Evelyn).
 * @type {import('../../core/Plataforma.js').Modulo}
 */
export const moduloOps = {
  nombre: 'ops',

  registrar(p) {
    const servicio = new OpsService({ repositorio: new OpsRepository({ redis: p.redis }) });
    new OpsStream({
      servicio,
      auth: p.auth,
      redis: p.redis,
      conexiones: p.conexiones,
      logger: p.logger,
    }).registrar(p.router, p.tareas);
    p.contenedor.registrar('opsService', servicio);
  },
};
