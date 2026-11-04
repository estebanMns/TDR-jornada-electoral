'use client';

import { useEffect, useRef, useState } from 'react';
import { conectarSse } from '@/shared/net/sse';

const INFORMADAS = '_reported';
const RESERVADO = /^_/;

/** Compara ids de stream `ms-seq`. */
function compararId(a, b) {
  const [am, as] = String(a).split('-').map(Number);
  const [bm, bs] = String(b).split('-').map(Number);
  return am === bm ? as - bs : am - bm;
}

/**
 * Estado en vivo de un tópico (`dep`, `mun:11`, `station:176`).
 *
 * - Aplica `snapshot` (estado completo) y `delta` (valores absolutos de lo que cambió).
 * - Ignora mensajes con id ya visto (un replay solapado es inofensivo).
 * - Agrupa las actualizaciones en un `requestAnimationFrame`: aunque lleguen
 *   varios mensajes seguidos se re-renderiza una vez por cuadro (RT-9, INP).
 * - Si un número baja, muestra el motivo (corrección o acta en verificación).
 */
export function useResultados(topico) {
  const [vista, setVista] = useState({ valores: {}, mesas: { informadas: 0, total: 0 }, actualizado: null });
  const [estado, setEstado] = useState('reconectando');
  const [aviso, setAviso] = useState(null);
  const ref = useRef({ valores: {}, mesas: { informadas: 0, total: 0 }, ultimoId: null, cola: [], cuadro: null });

  useEffect(() => {
    const s = ref.current;
    s.valores = {};
    s.mesas = { informadas: 0, total: 0 };
    s.ultimoId = null;
    s.cola = [];
    setVista({ valores: {}, mesas: s.mesas, actualizado: null });
    setAviso(null);
    if (!topico) return undefined;

    const procesar = () => {
      s.cuadro = null;
      let bajo = null;
      for (const { evento, datos, id } of s.cola.splice(0)) {
        if (datos?.topico !== topico) continue;
        if (id && s.ultimoId && compararId(id, s.ultimoId) <= 0 && evento === 'delta') continue;
        if (id) s.ultimoId = id;
        if (evento === 'snapshot') {
          s.valores = soloVotos(datos.totales);
          s.mesas = { ...datos.mesas };
        } else {
          for (const [campo, valor] of Object.entries(datos.cambios ?? {})) {
            if (campo === INFORMADAS) {
              s.mesas = { ...s.mesas, informadas: valor };
              continue;
            }
            if (RESERVADO.test(campo)) continue;
            if (valor < (s.valores[campo] ?? 0)) bajo = datos.motivos?.at(-1) ?? { tipo: 'CORRECCION' };
            s.valores = { ...s.valores, [campo]: valor };
          }
        }
      }
      if (bajo) setAviso({ ...bajo, en: Date.now() });
      setVista({ valores: s.valores, mesas: s.mesas, actualizado: Date.now() });
    };

    const cerrar = conectarSse({
      url: `/api/publico/stream?topics=${encodeURIComponent(topico)}`,
      alEstado: setEstado,
      alMensaje: (mensaje) => {
        if (mensaje.evento !== 'snapshot' && mensaje.evento !== 'delta') return;
        s.cola.push(mensaje);
        s.cuadro ??= requestAnimationFrame(procesar);
      },
    });
    return () => {
      cerrar();
      if (s.cuadro) cancelAnimationFrame(s.cuadro);
      s.cuadro = null;
    };
  }, [topico]);

  return { ...vista, estado, aviso };
}

function soloVotos(totales = {}) {
  const votos = {};
  for (const [campo, valor] of Object.entries(totales)) if (!RESERVADO.test(campo)) votos[campo] = valor;
  return votos;
}
