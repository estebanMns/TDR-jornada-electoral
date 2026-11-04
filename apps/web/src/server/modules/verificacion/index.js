import { redisKeys } from '@preconteo/shared';
import { CanalRedis } from '../../core/redis/CanalRedis.js';
import { TareaPeriodica } from '../../core/tasks/TareaPeriodica.js';
import { VerificacionRepository } from './verificacion.repository.js';
import { PresenciaRepository } from './presencia.repository.js';
import { HistorialVerificacionRepository } from './historial.repository.js';
import { ActasPuertoPerezoso, ActasServiceStub } from './actas.puerto.js';
import { VerificacionService } from './verificacion.service.js';
import { PresenciaService } from './presencia.service.js';
import { VerificacionController } from './verificacion.controller.js';
import { ComandosVerificacion } from './ws/ComandosVerificacion.js';
import { VerificacionGateway } from './ws/VerificacionGateway.js';

/**
 * Módulo de verificación colaborativa y presencia (RF-7, RF-8). Dueño: Meneses.
 * Raíz de composición del módulo: aquí (y solo aquí) se cablean las dependencias.
 * @type {import('../../core/Plataforma.js').Modulo}
 */
export const moduloVerificacion = {
  nombre: 'verificacion',

  registrar(p) {
    const { redis, pubsub, supabase, metrics, logger, contenedor, config } = p;

    const repositorio = new VerificacionRepository({ redis });
    const historial = new HistorialVerificacionRepository({
      supabase,
      bucketFotos: config.supabase.bucketFotos,
      logger,
    });
    const canalVerificacion = new CanalRedis({
      pubsub,
      canal: redisKeys.verificacion.canal,
      logger,
    });
    const canalPresencia = new CanalRedis({ pubsub, canal: redisKeys.presencia.canal, logger });

    const servicio = new VerificacionService({
      repositorio,
      historial,
      actas: new ActasPuertoPerezoso({ contenedor, respaldo: new ActasServiceStub({ logger }) }),
      canal: canalVerificacion,
      metrics,
    });
    const presencia = new PresenciaService({
      repositorio: new PresenciaRepository({ redis }),
      canal: canalPresencia,
      instancia: p.instancia,
    });

    new VerificacionGateway({
      auth: p.auth,
      comandos: new ComandosVerificacion({ servicio, presencia }),
      presencia,
      canalVerificacion,
      canalPresencia,
      conexiones: p.conexiones,
      redis,
      metrics,
      logger,
    }).registrar(p.router, p.tareas);

    // Reaper en TODAS las instancias cada 5 s (el Lua es idempotente).
    p.tareas.agregar(
      new TareaPeriodica({
        nombre: 'verificacion-reaper',
        intervaloMs: 5_000,
        logger,
        ejecutar: () => redis.disponible() && servicio.liberarExpirados(),
      }),
    );

    contenedor.registrar('verificacionService', servicio);
    contenedor.registrarControlador(
      'verificacion',
      new VerificacionController({ http: p.http, auth: p.auth, repositorio, historial }),
    );
  },
};
