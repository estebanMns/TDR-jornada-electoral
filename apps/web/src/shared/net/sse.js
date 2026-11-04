import { esperaConJitter } from './backoff';

/** @typedef {'en_vivo' | 'reconectando' | 'pausado'} EstadoSse */

const EVENTOS = ['snapshot', 'delta', 'estado', 'reconectar', 'metricas'];

/**
 * Cliente SSE con continuidad (RF-6) y reconexión con jitter (RF-10).
 *
 * `EventSource` reconecta solo, pero con una espera fija para todos; aquí se
 * cierra ante el error y se reconecta a mano con backoff + jitter, enviando el
 * último id recibido como `?lastEventId=` (EventSource no deja poner headers).
 *
 * @param {{ url: string, alMensaje: (m: { id?: string, evento: string, datos: any }) => void,
 *           alEstado?: (e: EstadoSse) => void }} opciones
 * @returns {() => void} función para cerrar
 */
export function conectarSse({ url, alMensaje, alEstado }) {
  let fuente = null;
  let temporizador = null;
  let cerrado = false;
  let intento = 0;
  let ultimoId = '';

  const reintentar = () => {
    if (cerrado || temporizador) return;
    fuente?.close();
    alEstado?.('reconectando');
    temporizador = setTimeout(() => {
      temporizador = null;
      intento += 1;
      abrir();
    }, esperaConJitter(intento));
  };

  const manejar = (evento) => {
    if (evento.lastEventId) ultimoId = evento.lastEventId;
    let datos = evento.data;
    try {
      datos = JSON.parse(evento.data);
    } catch {
      /* texto plano */
    }
    if (evento.type === 'reconectar') return reintentar();
    if (evento.type === 'estado') alEstado?.(datos?.pausado ? 'pausado' : 'en_vivo');
    alMensaje({ id: evento.lastEventId || undefined, evento: evento.type, datos });
  };

  const abrir = () => {
    if (cerrado) return;
    const destino = new URL(url, window.location.origin);
    if (ultimoId) destino.searchParams.set('lastEventId', ultimoId);
    fuente = new EventSource(destino);
    fuente.onopen = () => {
      intento = 0;
      alEstado?.('en_vivo');
    };
    for (const tipo of EVENTOS) fuente.addEventListener(tipo, manejar);
    fuente.onerror = reintentar;
  };

  abrir();
  return () => {
    cerrado = true;
    clearTimeout(temporizador);
    fuente?.close();
  };
}
