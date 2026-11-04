/**
 * Índice tópico → conexiones (RF-5).
 *
 * - `#porTopico`: Map<tópico, Set<conexión>> → el fan-out recorre SOLO los
 *   suscriptores del tópico: costo O(suscriptores), no O(conexiones de la instancia).
 * - `#porConexion`: Map<conexión, Set<tópico>> → la baja no busca en todos los tópicos.
 *
 * Alta O(1), baja O(tópicos de la conexión) (máx. 3), recorrido O(suscriptores).
 */
export class TopicRegistry {
  #porTopico = new Map();
  #porConexion = new Map();

  add(topico, conexion) {
    let suscriptores = this.#porTopico.get(topico);
    if (!suscriptores) this.#porTopico.set(topico, (suscriptores = new Set()));
    if (suscriptores.has(conexion)) return false;
    suscriptores.add(conexion);
    let topicos = this.#porConexion.get(conexion);
    if (!topicos) this.#porConexion.set(conexion, (topicos = new Set()));
    topicos.add(topico);
    return true;
  }

  removeConnection(conexion) {
    const topicos = this.#porConexion.get(conexion);
    if (!topicos) return;
    for (const topico of topicos) {
      const suscriptores = this.#porTopico.get(topico);
      suscriptores?.delete(conexion);
      if (suscriptores && suscriptores.size === 0) this.#porTopico.delete(topico);
    }
    this.#porConexion.delete(conexion);
  }

  subscribers(topico) {
    return this.#porTopico.get(topico) ?? VACIO;
  }

  count(topico) {
    return this.#porTopico.get(topico)?.size ?? 0;
  }

  totalConexiones() {
    return this.#porConexion.size;
  }

  /** Todas las conexiones (una vez cada una). */
  todas() {
    return this.#porConexion.keys();
  }

  /** Número de tópicos con suscriptores (métrica). */
  topicos() {
    return this.#porTopico.size;
  }
}

const VACIO = new Set();
