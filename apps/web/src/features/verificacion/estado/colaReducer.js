import { MensajeServidor as M, scoreDeCaso } from '@preconteo/shared/schemas/verificacion';

/**
 * Estado de la consola como función pura de los mensajes del servidor.
 * Pendientes/en curso se DERIVAN de los items (no se llevan contadores que se desfasen).
 */
export const estadoInicial = Object.freeze({
  items: [],
  resueltos: 0,
  presencia: [],
  redis: 'ok',
  conexion: 'conectando',
  casoEnCurso: null,
  ultimoError: null,
});

export const Accion = Object.freeze({
  CONEXION: 'local/conexion',
  CASO_EN_CURSO: 'local/casoEnCurso',
  LIMPIAR_ERROR: 'local/limpiarError',
});

const porScore = (a, b) => a.score - b.score;
const actualizarItem = (items, acta, cambio) =>
  items.map((i) => (i.acta === acta ? { ...i, ...cambio } : i));

export function colaReducer(estado, accion) {
  switch (accion.tipo) {
    case M.ESTADO_COLA:
      return {
        ...estado,
        items: [...accion.items].sort(porScore),
        resueltos: accion.contadores.resueltos,
      };

    case M.CASO_NUEVO: {
      if (estado.items.some((i) => i.acta === accion.item.acta)) return estado;
      const item = { ...accion.item, score: scoreDeCaso(accion.item), tomadoPor: null };
      return { ...estado, items: [...estado.items, item].sort(porScore) };
    }

    case M.CASO_TOMADO:
      return {
        ...estado,
        items: actualizarItem(estado.items, accion.acta, { tomadoPor: accion.auditor }),
      };

    case M.CASO_LIBERADO:
      return { ...estado, items: actualizarItem(estado.items, accion.acta, { tomadoPor: null }) };

    case M.CASO_RESUELTO:
      return {
        ...estado,
        items: estado.items.filter((i) => i.acta !== accion.acta),
        resueltos: estado.resueltos + 1,
      };

    case M.PRESENCIA:
      return { ...estado, presencia: accion.lista };

    case M.ESTADO:
      return { ...estado, redis: accion.redis };

    case M.ERROR:
      return {
        ...estado,
        ultimoError: { codigo: accion.codigo, acta: accion.acta, en: Date.now() },
      };

    case Accion.CONEXION:
      return { ...estado, conexion: accion.estado };

    case Accion.CASO_EN_CURSO:
      return { ...estado, casoEnCurso: accion.caso };

    case Accion.LIMPIAR_ERROR:
      return { ...estado, ultimoError: null };

    default:
      return estado;
  }
}

/** Selectores. */
export const contadores = (estado) => {
  const enCurso = estado.items.filter((i) => i.tomadoPor).length;
  return { pendientes: estado.items.length - enCurso, enCurso, resueltos: estado.resueltos };
};

export const puedeOperar = (estado) => estado.conexion === 'conectado' && estado.redis === 'ok';
