import { duracion } from '@/features/verificacion/formato';
import { Insignia, Tarjeta } from '@/features/verificacion/componentes/ui';

/** Un auditor en el panel: instancia, caso actual, cuánto lleva y si está activo. */
export function TarjetaAuditor({ auditor, ahora }) {
  return (
    <Tarjeta className={auditor.activo ? '' : 'opacity-70'}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{auditor.nombre}</p>
          <p className="text-xs text-tinta-suave">
            {auditor.rol.toLowerCase()} · conectado hace {duracion(ahora - auditor.conectadoDesde)}
          </p>
        </div>
        <Insignia tono={auditor.activo ? 'verde' : 'ambar'}>
          {auditor.activo ? 'Activo' : 'Inactivo'}
        </Insignia>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
        <dt className="text-tinta-suave">Instancia</dt>
        <dd className="text-right font-mono">{auditor.instancia}</dd>
        <dt className="text-tinta-suave">Caso</dt>
        <dd className="text-right font-mono">{auditor.caso ?? '—'}</dd>
        <dt className="text-tinta-suave">Lleva</dt>
        <dd className="text-right tabular-nums">
          {auditor.caso && auditor.casoDesde ? duracion(ahora - auditor.casoDesde) : '—'}
        </dd>
      </dl>
    </Tarjeta>
  );
}
