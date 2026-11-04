'use client';

import { useEffect } from 'react';
import { useVerificacion } from '../VerificacionProvider';
import { MENSAJE_ERROR } from '../formato';
import { Insignia } from './ui';

const CONEXION = {
  conectado: { tono: 'verde', texto: 'En vivo' },
  conectando: { tono: 'ambar', texto: 'Conectando…' },
  reconectando: { tono: 'ambar', texto: 'Reconectando…' },
  cerrado: { tono: 'neutro', texto: 'Desconectado' },
};

/** Indicador de conexión + aviso de Redis degradado + último error. Nunca hay silencio. */
export function EstadoConsola() {
  const { estado, limpiarError } = useVerificacion();
  const { tono, texto } = CONEXION[estado.conexion] ?? CONEXION.cerrado;

  useEffect(() => {
    if (!estado.ultimoError) return;
    const id = setTimeout(limpiarError, 6_000);
    return () => clearTimeout(id);
  }, [estado.ultimoError, limpiarError]);

  return (
    <div className="space-y-2">
      <Insignia tono={tono}>● {texto}</Insignia>
      {estado.redis !== 'ok' && (
        <p
          role="status"
          className="rounded-lg bg-revision/10 px-3 py-2 text-sm text-revision"
        >
          Servicio degradado: las acciones están deshabilitadas hasta que se recupere.
        </p>
      )}
      {estado.ultimoError && (
        <p
          role="alert"
          className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700"
        >
          {MENSAJE_ERROR[estado.ultimoError.codigo] ?? `Error: ${estado.ultimoError.codigo}`}
          {estado.ultimoError.acta && ` (${estado.ultimoError.acta})`}
        </p>
      )}
    </div>
  );
}
