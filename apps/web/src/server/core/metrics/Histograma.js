/**
 * Histograma simple por ventana con muestreo de reservorio (memoria acotada).
 * Suficiente para p50/p99 en el tablero; no pretende exactitud estadística fina.
 */
export class Histograma {
  #muestras = [];
  #vistos = 0;
  #maximo = 0;

  constructor(capacidad = 2048) {
    this.capacidad = capacidad;
  }

  registrar(valor) {
    this.#vistos += 1;
    if (valor > this.#maximo) this.#maximo = valor;
    if (this.#muestras.length < this.capacidad) {
      this.#muestras.push(valor);
      return;
    }
    const posicion = Math.floor(Math.random() * this.#vistos);
    if (posicion < this.capacidad) this.#muestras[posicion] = valor;
  }

  /** Resumen de la ventana y reinicio. */
  cerrarVentana() {
    const ordenadas = this.#muestras.toSorted((a, b) => a - b);
    const percentil = (p) =>
      ordenadas.length === 0
        ? 0
        : ordenadas[Math.min(ordenadas.length - 1, Math.floor(p * ordenadas.length))];
    const resumen = {
      n: this.#vistos,
      p50: percentil(0.5),
      p99: percentil(0.99),
      max: this.#maximo,
    };
    this.#muestras = [];
    this.#vistos = 0;
    this.#maximo = 0;
    return resumen;
  }
}
