import { cargarConfig } from './config/Config.js';
import { crearLogger } from './logger.js';
import { Contenedor } from './Contenedor.js';
import { RedisGateway } from './redis/RedisGateway.js';
import { RedisPubSub } from './redis/RedisPubSub.js';
import { crearClienteSupabase } from './supabase/crearClienteSupabase.js';
import { MetricsRegistry } from './metrics/MetricsRegistry.js';
import { MetricsPublisher } from './metrics/MetricsPublisher.js';
import { EventLoopMonitor } from './eventLoop/EventLoopMonitor.js';
import { ConnectionRegistry } from './transport/ConnectionRegistry.js';
import { RealtimeRouter } from './realtime/RealtimeRouter.js';
import { Planificador } from './tasks/Planificador.js';
import { ManejadorHttp } from './http/ManejadorHttp.js';
import { RateLimiter } from './rateLimit/RateLimiter.js';
import { TokenService } from './auth/TokenService.js';
import { PasswordHasher } from './auth/PasswordHasher.js';
import { UsuariosRepository } from './auth/UsuariosRepository.js';
import { AuthService } from './auth/AuthService.js';
import { AuthController } from './auth/AuthController.js';
import { PlataformaController } from './plataforma/PlataformaController.js';
import { ApagadoOrdenado } from './lifecycle/ApagadoOrdenado.js';

/**
 * @typedef {{ nombre: string, registrar: (plataforma: Plataforma) => void }} Modulo
 * Cada módulo de negocio (verificación, ops, actas, público) es un objeto así.
 */

/**
 * Raíz de composición del núcleo: crea los servicios compartidos una sola vez
 * y los expone a los módulos. Los módulos reciben la plataforma (inyección de
 * dependencias explícita) y nunca crean conexiones propias.
 */
export class Plataforma {
  /** @param {NodeJS.ProcessEnv} env */
  static desdeEntorno(env = process.env) {
    const config = cargarConfig(env);
    return new Plataforma(config, crearLogger(config));
  }

  /**
   * @param {import('./config/Config.js').Config} config
   * @param {import('pino').Logger} logger
   */
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.instancia = config.instancia;
    this.contenedor = new Contenedor();

    this.redis = new RedisGateway({ ...config.redis, logger });
    this.pubsub = new RedisPubSub({ gateway: this.redis, logger });
    this.supabase = crearClienteSupabase(config.supabase);

    this.metrics = new MetricsRegistry();
    this.eventLoop = new EventLoopMonitor({ logger });
    this.conexiones = new ConnectionRegistry();
    this.router = new RealtimeRouter({ instancia: this.instancia, logger });
    this.tareas = new Planificador();
    this.http = new ManejadorHttp({ logger });
    this.limitador = new RateLimiter({ redis: this.redis });
    this.auth = new AuthService({
      usuarios: new UsuariosRepository({ supabase: this.supabase }),
      hasher: new PasswordHasher(),
      tokens: new TokenService(config.jwt),
    });
    this.apagado = new ApagadoOrdenado({ logger });

    this.#registrarMetricasBase();
    this.#registrarControladoresBase();
  }

  /** @param {Modulo} modulo */
  usar(modulo) {
    modulo.registrar(this);
    this.logger.info({ modulo: modulo.nombre }, 'módulo registrado');
    return this;
  }

  iniciar() {
    this.redis.iniciar();
    this.tareas.iniciar();
  }

  /** Pasos de apagado del núcleo (después de dejar de aceptar conexiones). */
  async detener() {
    this.conexiones.cerrarTodas('reinicio');
    this.router.cerrar();
    this.tareas.detener();
    await this.redis.detener();
  }

  #registrarMetricasBase() {
    this.eventLoop.registrarEn(this.metrics);
    this.conexiones.registrarEn(this.metrics);
    this.metrics.gauge('memoria', () => {
      const { rss, heapUsed } = process.memoryUsage();
      return { rss, heapUsed };
    });
    this.tareas.agregar(this.eventLoop);
    this.tareas.agregar(
      new MetricsPublisher({
        instancia: this.instancia,
        metrics: this.metrics,
        redis: this.redis,
        logger: this.logger,
      }),
    );
  }

  #registrarControladoresBase() {
    const { http, auth, limitador, redis, config, instancia } = this;
    this.contenedor.registrarControlador(
      'plataforma',
      new PlataformaController({ instancia, redis, http }),
    );
    this.contenedor.registrarControlador(
      'auth',
      new AuthController({ auth, limitador, http, config }),
    );
  }
}
