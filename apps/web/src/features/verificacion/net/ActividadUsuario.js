const EVENTOS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart'];

/**
 * Registra la última interacción REAL (mouse/teclado/scroll) del auditor.
 * Con esto el servidor decide si renueva el lease (GENERAL §9.3).
 */
export class ActividadUsuario {
  #ultima = Date.now();
  #registrar = () => {
    this.#ultima = Date.now();
  };

  iniciar() {
    for (const evento of EVENTOS)
      window.addEventListener(evento, this.#registrar, { passive: true, capture: true });
  }

  detener() {
    for (const evento of EVENTOS)
      window.removeEventListener(evento, this.#registrar, { capture: true });
  }

  get ultima() {
    return this.#ultima;
  }

  inactivoMs() {
    return Date.now() - this.#ultima;
  }
}
