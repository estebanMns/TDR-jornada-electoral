'use client';

import { useState } from 'react';
import { Boton } from './ui';

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;

/** Foto del acta (URL firmada vía redirección del servidor) con zoom y desplazamiento. */
export function VisorFoto({ acta }) {
  const [zoom, setZoom] = useState(1);
  const [fallo, setFallo] = useState(false);
  const cambiar = (delta) => setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z + delta)));

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <Boton
          variante="borde"
          onClick={() => cambiar(-0.5)}
          disabled={zoom <= ZOOM_MIN}
          aria-label="Alejar"
        >
          −
        </Boton>
        <span className="w-12 text-center text-sm tabular-nums">{Math.round(zoom * 100)}%</span>
        <Boton
          variante="borde"
          onClick={() => cambiar(0.5)}
          disabled={zoom >= ZOOM_MAX}
          aria-label="Acercar"
        >
          +
        </Boton>
        <Boton variante="borde" onClick={() => setZoom(1)}>
          Ajustar
        </Boton>
      </div>
      <div className="min-h-[24rem] flex-1 overflow-auto rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-950">
        {fallo ? (
          <p className="grid h-full place-items-center p-8 text-sm text-slate-500">
            Foto no disponible para esta versión.
          </p>
        ) : (
          // <img> y no next/image: la URL firmada es de corta vida y no debe cachearse.
          <img
            src={`/api/verificacion/${encodeURIComponent(acta)}/foto`}
            alt={`Foto del acta ${acta}`}
            onError={() => setFallo(true)}
            style={{ width: `${zoom * 100}%`, maxWidth: 'none' }}
            className="select-none"
            draggable={false}
          />
        )}
      </div>
    </div>
  );
}
