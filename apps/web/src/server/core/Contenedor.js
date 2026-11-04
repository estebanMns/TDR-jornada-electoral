/**
 * Contenedor de dependencias mínimo: registro por nombre.
 * Los controladores se registran aquí para que las rutas de Next los encuentren.
 */
export class Contenedor {
  /** @type {Map<string, unknown>} */
  #servicios = new Map();
  /** @type {Map<string, object>} */
  #controladores = new Map();

  registrar(nombre, instancia) {
    if (this.#servicios.has(nombre)) throw new Error(`Servicio duplicado: ${nombre}`);
    this.#servicios.set(nombre, instancia);
    return instancia;
  }

  tiene(nombre) {
    return this.#servicios.has(nombre);
  }

  obtener(nombre) {
    if (!this.#servicios.has(nombre)) throw new Error(`Servicio no registrado: ${nombre}`);
    return this.#servicios.get(nombre);
  }

  registrarControlador(nombre, controlador) {
    if (this.#controladores.has(nombre)) throw new Error(`Controlador duplicado: ${nombre}`);
    this.#controladores.set(nombre, controlador);
  }

  controlador(nombre) {
    const c = this.#controladores.get(nombre);
    if (!c) throw new Error(`Controlador no registrado: ${nombre}`);
    return c;
  }
}
