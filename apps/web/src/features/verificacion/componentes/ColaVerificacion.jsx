'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useVerificacion } from '../VerificacionProvider';
import { contadores, puedeOperar } from '../estado/colaReducer';
import { useAhora } from '../hooks/useAhora';
import { duracion, ETIQUETA_MOTIVO, ETIQUETA_PRIORIDAD } from '../formato';
import { EstadoConsola } from './EstadoConsola';
import { Boton, Insignia, Tarjeta, IconoCandado } from './ui';

const TONO_PRIORIDAD = { 1: 'rojo', 2: 'ambar', 3: 'neutro' };

/** `/verificacion`: cola en vivo ordenada por prioridad. */
export function ColaVerificacion() {
  const { estado, cliente } = useVerificacion();
  const router = useRouter();
  const ahora = useAhora();
  const [tomando, setTomando] = useState(null);
  const operable = puedeOperar(estado);
  const miCaso = estado.casoEnCurso?.acta;
  const { pendientes, enCurso, resueltos } = contadores(estado);

  async function tomar(acta) {
    setTomando(acta);
    try {
      await cliente().tomar(acta);
      router.push(`/verificacion/${encodeURIComponent(acta)}`);
    } catch {
      // El error ya llegó al estado por el canal de mensajes y se muestra arriba.
    } finally {
      setTomando(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Cola de verificación</h1>
          <p className="text-sm text-tinta-suave">
            {pendientes} pendientes · {enCurso} en curso · {resueltos} resueltos
          </p>
        </div>
        <EstadoConsola />
      </div>

      {miCaso && (
        <Tarjeta className="flex items-center justify-between border-registrada/40">
          <span className="text-sm">
            Tienes tomado el caso <strong>{miCaso}</strong>.
          </span>
          <Boton onClick={() => router.push(`/verificacion/${encodeURIComponent(miCaso)}`)}>
            Continuar
          </Boton>
        </Tarjeta>
      )}

      <Tarjeta className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-rejilla text-xs uppercase text-tinta-suave">
            <tr>
              {['Prioridad', 'Acta', 'Municipio / puesto', 'Motivo', 'En cola', ''].map((t) => (
                <th key={t} className="px-4 py-3 font-medium">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {estado.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-tinta-suave">
                  No hay casos por verificar.
                </td>
              </tr>
            )}
            {estado.items.map((item) => (
              <FilaCaso
                key={item.acta}
                item={item}
                ahora={ahora}
                esMio={item.acta === miCaso}
                deshabilitado={!operable || Boolean(miCaso) || tomando !== null}
                tomando={tomando === item.acta}
                onTomar={() => tomar(item.acta)}
              />
            ))}
          </tbody>
        </table>
      </Tarjeta>
    </div>
  );
}

function FilaCaso({ item, ahora, esMio, deshabilitado, tomando, onTomar }) {
  const tomadoPorOtro = item.tomadoPor && !esMio;
  return (
    <tr
      className={`border-b border-rejilla last:border-0 ${tomadoPorOtro ? 'bg-papel text-tinta-suave' : ''}`}
    >
      <td className="px-4 py-3">
        <Insignia tono={TONO_PRIORIDAD[item.prioridad]}>
          {ETIQUETA_PRIORIDAD[item.prioridad]}
        </Insignia>
      </td>
      <td className="px-4 py-3 font-mono">{item.acta}</td>
      <td className="px-4 py-3">
        {item.municipio.nombre}
        <span className="block text-xs text-tinta-suave">
          {item.puesto.nombre} · mesa {item.mesa}
        </span>
      </td>
      <td className="px-4 py-3">{ETIQUETA_MOTIVO[item.motivo] ?? item.motivo}</td>
      <td className="px-4 py-3 tabular-nums">{duracion(ahora - item.encoladaEn)}</td>
      <td className="px-4 py-3 text-right">
        {item.tomadoPor ? (
          <Insignia tono={esMio ? 'verde' : 'neutro'}>
            <IconoCandado /> {esMio ? 'Tú' : item.tomadoPor.nombre}
          </Insignia>
        ) : (
          <Boton onClick={onTomar} disabled={deshabilitado}>
            {tomando ? 'Tomando…' : 'Tomar'}
          </Boton>
        )}
      </td>
    </tr>
  );
}
