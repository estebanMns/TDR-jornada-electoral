'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useVerificacion } from '../VerificacionProvider';
import { puedeOperar } from '../estado/colaReducer';
import { ETIQUETA_MOTIVO } from '../formato';
import { EstadoConsola } from './EstadoConsola';
import { BarraBloqueo } from './BarraBloqueo';
import { VisorFoto } from './VisorFoto';
import { FormularioResolucion } from './FormularioResolucion';
import { Tarjeta, Insignia } from './ui';

/** `/verificacion/:acta`: foto + valores + decisión del auditor que tiene el caso. */
export function DetalleCaso({ acta }) {
  const { estado, cliente } = useVerificacion();
  const router = useRouter();
  const caso = estado.items.find((i) => i.acta === acta);
  const esMio = estado.casoEnCurso?.acta === acta;
  const volver = () => router.push('/verificacion');

  async function accion(fn) {
    try {
      await fn();
      volver();
    } catch {
      // El error se muestra con EstadoConsola (llega por el canal de mensajes).
    }
  }

  if (!caso || !esMio) {
    return (
      <Tarjeta className="space-y-3">
        <EstadoConsola />
        <p>
          {estado.conexion !== 'conectado'
            ? 'Cargando el caso…'
            : !caso
              ? 'Este caso ya no está en la cola (pudo resolverse).'
              : 'No tienes este caso tomado.'}
        </p>
        <Link href="/verificacion" className="text-sm underline">
          Volver a la cola
        </Link>
      </Tarjeta>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/verificacion" className="text-sm text-tinta-suave hover:underline">
            ← Cola
          </Link>
          <h1 className="font-mono text-2xl font-semibold">{caso.acta}</h1>
          <p className="text-sm text-tinta-suave">
            {caso.municipio.nombre} · {caso.puesto.nombre} · mesa {caso.mesa} · versión{' '}
            {caso.version}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Insignia tono="ambar">{ETIQUETA_MOTIVO[caso.motivo] ?? caso.motivo}</Insignia>
          <EstadoConsola />
        </div>
      </div>

      <BarraBloqueo />

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Tarjeta>
          <VisorFoto acta={caso.acta} />
        </Tarjeta>
        <Tarjeta>
          <FormularioResolucion
            key={caso.acta}
            caso={caso}
            deshabilitado={!puedeOperar(estado)}
            onResolver={(datos) => accion(() => cliente().resolver(datos))}
            onSoltar={() => accion(() => cliente().soltar())}
          />
        </Tarjeta>
      </div>
    </div>
  );
}
