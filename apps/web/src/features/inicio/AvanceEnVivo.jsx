'use client';

import Link from 'next/link';
import { useResultados } from '@/features/publico/useResultados';
import { MapaMesas, PuntoEstado, Rotulo, formatoNumero, formatoPorcentaje } from '@/shared/ui';

const TOTAL_MESAS = 6_400;

/** Avance del departamento en vivo para la portada (mismo stream que /resultados). */
export function AvanceEnVivo() {
  const { mesas, estado } = useResultados('dep');
  const total = mesas.total || TOTAL_MESAS;
  const pct = total ? (mesas.informadas / total) * 100 : 0;

  return (
    <figure className="rounded-2xl border border-rejilla bg-hoja p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <Rotulo>Mesas del departamento</Rotulo>
        <PuntoEstado estado={estado} />
      </div>
      <MapaMesas total={total} informadas={mesas.informadas} altoMax={260} className="mt-5" />
      <figcaption className="mt-5 flex flex-wrap items-end justify-between gap-3">
        <p>
          <span className="font-display text-4xl font-bold tabular-nums tracking-tight">
            {formatoNumero(mesas.informadas)}
          </span>
          <span className="ml-2 text-tinta-suave">de {formatoNumero(total)} mesas informadas</span>
        </p>
        <Link
          href="/resultados"
          className="font-mono text-sm font-medium text-indeleble underline-offset-4 hover:underline"
        >
          {formatoPorcentaje(pct)} · ver detalle →
        </Link>
      </figcaption>
    </figure>
  );
}
