'use client';

import { useEffect, useMemo, useRef } from 'react';

/**
 * Mapa de mesas: una celda por mesa del nivel (6.400 en el departamento).
 * Las mesas informadas se "entintan" con el violeta de la tinta indeleble y
 * las nuevas aparecen con un fundido corto. Se dibuja en <canvas>: miles de
 * celdas sin miles de nodos en el DOM (importa en un teléfono de gama baja).
 *
 * El orden en que se entintan es una permutación fija (no la ubicación real
 * de cada mesa): representa la proporción informada, no cuáles informaron.
 */
export function MapaMesas({ total, informadas, altoMax = 320, className = '' }) {
  const lienzo = useRef(null);
  const estado = useRef({ pintadas: 0, animacion: null });
  const orden = useMemo(() => permutacion(total), [total]);

  useEffect(() => {
    const canvas = lienzo.current;
    if (!canvas || total <= 0) return undefined;
    const reducir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const dibujar = (desde, hasta, opacidadNuevas) => {
      const ancho = canvas.parentElement.clientWidth;
      const { lado, separacion, columnas, filas } = geometria(ancho, altoMax, total);
      const dpr = window.devicePixelRatio || 1;
      const alto = filas * (lado + separacion);
      if (canvas.width !== Math.round(ancho * dpr) || canvas.height !== Math.round(alto * dpr)) {
        canvas.width = Math.round(ancho * dpr);
        canvas.height = Math.round(alto * dpr);
        canvas.style.height = `${alto}px`;
      }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, ancho, alto);
      const css = getComputedStyle(document.documentElement);
      const vacia = css.getPropertyValue('--color-rejilla').trim() || '#d3dae8';
      const tinta = css.getPropertyValue('--color-indeleble').trim() || '#6b3fd0';
      const entintada = new Uint8Array(total);
      for (let i = 0; i < Math.min(hasta, total); i++) entintada[orden[i]] = i < desde ? 2 : 1;

      for (let celda = 0; celda < total; celda++) {
        const x = (celda % columnas) * (lado + separacion);
        const y = Math.floor(celda / columnas) * (lado + separacion);
        ctx.globalAlpha = 1;
        ctx.fillStyle = vacia;
        ctx.fillRect(x, y, lado, lado);
        if (entintada[celda]) {
          ctx.globalAlpha = entintada[celda] === 2 ? 1 : opacidadNuevas;
          ctx.fillStyle = tinta;
          ctx.fillRect(x, y, lado, lado);
        }
      }
      ctx.globalAlpha = 1;
    };

    const s = estado.current;
    const desde = Math.min(s.pintadas, informadas);
    cancelAnimationFrame(s.animacion);
    if (reducir || informadas <= desde) {
      dibujar(informadas, informadas, 1);
    } else {
      const inicio = performance.now();
      const paso = (ahora) => {
        const t = Math.min(1, (ahora - inicio) / 700);
        dibujar(desde, informadas, t);
        if (t < 1) s.animacion = requestAnimationFrame(paso);
      };
      s.animacion = requestAnimationFrame(paso);
    }
    s.pintadas = informadas;

    const observador = new ResizeObserver(() => dibujar(informadas, informadas, 1));
    observador.observe(canvas.parentElement);
    return () => {
      observador.disconnect();
      cancelAnimationFrame(s.animacion);
    };
  }, [total, informadas, altoMax, orden]);

  return (
    <div className={`w-full ${className}`}>
      <canvas
        ref={lienzo}
        role="img"
        aria-label={`${informadas.toLocaleString('es-CO')} de ${total.toLocaleString('es-CO')} mesas informadas`}
        className="block w-full"
      />
    </div>
  );
}

/** Tamaño de celda para que la cuadrícula llene el ancho sin pasar de `altoMax`. */
function geometria(ancho, altoMax, total) {
  let lado = Math.floor(Math.sqrt((ancho * altoMax) / total)) - 1;
  lado = Math.max(2, Math.min(22, lado));
  const separacion = lado >= 8 ? 2 : 1;
  const columnas = Math.max(1, Math.floor((ancho + separacion) / (lado + separacion)));
  return { lado, separacion, columnas, filas: Math.ceil(total / columnas) };
}

/** Permutación determinista de 0..n-1 (misma en cada visita, distinta por nivel). */
function permutacion(n) {
  const indices = Array.from({ length: Math.max(0, n) }, (_, i) => i);
  let semilla = (n * 2654435761) >>> 0 || 1;
  for (let i = indices.length - 1; i > 0; i--) {
    semilla = (semilla * 1664525 + 1013904223) >>> 0;
    const j = semilla % (i + 1);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}
