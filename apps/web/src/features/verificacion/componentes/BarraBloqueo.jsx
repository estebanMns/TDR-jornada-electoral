'use client';

import { LEASE } from '@preconteo/shared/schemas/verificacion';
import { useVerificacion } from '../VerificacionProvider';
import { useAhora } from '../hooks/useAhora';
import { duracion } from '../formato';

const AVISO_INACTIVIDAD_MS = 60_000;

/**
 * Estado del lease: se renueva con cada latido mientras haya actividad real.
 * Si el auditor deja de interactuar, avisa antes de que el caso vuelva a la cola.
 */
export function BarraBloqueo() {
  const { estado, cliente } = useVerificacion();
  useAhora(1_000); // refresca la cuenta atrás
  const caso = estado.casoEnCurso;
  if (!caso) return null;

  const restanteInactividad = LEASE.INACTIVIDAD_MAX_MS - (cliente()?.inactivoMs() ?? 0);
  const porExpirar = restanteInactividad <= AVISO_INACTIVIDAD_MS;
  const conectado = estado.conexion === 'conectado';

  const [clase, texto] = !conectado
    ? [
        'bg-revision/10 text-revision',
        'Sin conexión: el caso se liberará en ≤ 30 s si no vuelve la red.',
      ]
    : porExpirar
      ? [
          'bg-revision/10 text-revision',
          `Se liberará por inactividad en ${duracion(Math.max(0, restanteInactividad))}. Mueve el mouse o escribe para conservarlo.`,
        ]
      : [
          'bg-registrada/10 text-registrada',
          'Caso bloqueado para ti · renovándose automáticamente.',
        ];

  return (
    <div role="status" className={`rounded-lg px-3 py-2 text-sm ${clase}`}>
      {texto}
    </div>
  );
}
