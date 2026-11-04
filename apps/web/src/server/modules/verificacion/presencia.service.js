/**
 * Presencia de auditores (RF-8, GENERAL §8): latido → TTL; lista por ventana.
 * Publica en `ch:presence` solo cuando algo visible cambia (no en cada latido).
 */
export class PresenciaService {
  /**
   * @param {{ repositorio: import('./presencia.repository.js').PresenciaRepository,
   *           canal: import('../../core/redis/CanalRedis.js').CanalRedis,
   *           instancia: string, reloj?: () => number }} deps
   */
  constructor({ repositorio, canal, instancia, reloj = Date.now }) {
    this.repositorio = repositorio;
    this.canal = canal;
    this.instancia = instancia;
    this.reloj = reloj;
  }

  /**
   * @param {{ sub: string, nombre: string, rol: string }} usuario
   * @param {{ caso: { acta: string, desde: number|null } | null, activo: boolean, conectadoDesde: number }} estado
   */
  async latido(usuario, { caso, activo, conectadoDesde }) {
    const ahora = this.reloj();
    const entrada = {
      sub: usuario.sub,
      nombre: usuario.nombre,
      rol: usuario.rol,
      instancia: this.instancia,
      caso: caso?.acta ?? null,
      casoDesde: caso?.desde ?? null,
      activo,
      conectadoDesde,
      ultimoLatido: ahora,
    };
    const anterior = await this.repositorio.registrar(entrada, ahora);
    if (cambioVisible(anterior, entrada)) {
      await this.canal.publicarSinFallar({ tipo: 'cambio', sub: usuario.sub });
    }
  }

  /** Cierre limpio del WebSocket: se borra de inmediato (sin esperar el TTL). */
  async salir(sub) {
    await this.repositorio.eliminar(sub);
    await this.canal.publicarSinFallar({ tipo: 'salida', sub });
  }

  listar() {
    return this.repositorio.listar(this.reloj());
  }
}

function cambioVisible(anterior, actual) {
  if (!anterior) return true;
  return ['caso', 'activo', 'instancia'].some((campo) => anterior[campo] !== actual[campo]);
}
