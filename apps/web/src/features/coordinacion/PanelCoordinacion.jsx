'use client';

import Link from 'next/link';
import { useVerificacion } from '@/features/verificacion/VerificacionProvider';
import { contadores } from '@/features/verificacion/estado/colaReducer';
import { useAhora } from '@/features/verificacion/hooks/useAhora';
import { EstadoConsola } from '@/features/verificacion/componentes/EstadoConsola';
import { Tarjeta } from '@/features/verificacion/componentes/ui';
import { TarjetaAuditor } from './TarjetaAuditor';

/** `/coordinacion`: presencia de auditores en vivo + contadores de la cola (RF-8). */
export function PanelCoordinacion() {
  const { estado } = useVerificacion();
  const ahora = useAhora();
  const { pendientes, enCurso, resueltos } = contadores(estado);
  const auditores = [...estado.presencia].sort(
    (a, b) => Number(b.activo) - Number(a.activo) || a.nombre.localeCompare(b.nombre, 'es'),
  );
  const activos = auditores.filter((a) => a.activo).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Coordinación</h1>
          <p className="text-sm text-slate-500">
            {auditores.length} conectados · {activos} activos ·{' '}
            <Link href="/verificacion" className="underline">
              ver la cola
            </Link>
          </p>
        </div>
        <EstadoConsola />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Contador etiqueta="Pendientes" valor={pendientes} />
        <Contador etiqueta="En curso" valor={enCurso} />
        <Contador etiqueta="Resueltos" valor={resueltos} />
      </div>

      {auditores.length === 0 ? (
        <Tarjeta>
          <p className="text-sm text-slate-500">Ningún auditor conectado en este momento.</p>
        </Tarjeta>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {auditores.map((auditor) => (
            <li key={auditor.sub}>
              <TarjetaAuditor auditor={auditor} ahora={ahora} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Contador({ etiqueta, valor }) {
  return (
    <Tarjeta>
      <p className="text-sm text-slate-500">{etiqueta}</p>
      <p className="text-3xl font-semibold tabular-nums">{valor}</p>
    </Tarjeta>
  );
}
