/**
 * Registro de tareas periódicas de la instancia. Los módulos agregan las suyas
 * y la plataforma las arranca/detiene juntas.
 */
export class Planificador {
  /** @type {Array<{ iniciar(): void, detener(): void, nombre: string }>} */
  #tareas = [];

  agregar(tarea) {
    this.#tareas.push(tarea);
    return tarea;
  }

  iniciar() {
    for (const tarea of this.#tareas) tarea.iniciar();
  }

  detener() {
    for (const tarea of this.#tareas) tarea.detener();
  }

  nombres() {
    return this.#tareas.map((t) => t.nombre);
  }
}
