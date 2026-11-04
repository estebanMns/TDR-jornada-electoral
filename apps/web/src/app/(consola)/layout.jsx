import { usuarioActualORedirigir } from '@/app/auth/sesionServidor';
import { BarraSesion } from '@/app/auth/BarraSesion';
import { VerificacionProvider } from '@/features/verificacion/VerificacionProvider';

/**
 * Layout común de la consola de auditoría y coordinación. Un solo layout para
 * ambas secciones = un solo WebSocket al navegar entre ellas.
 */
export default async function LayoutConsola({ children }) {
  const usuario = await usuarioActualORedirigir();
  return (
    <>
      <BarraSesion usuario={usuario} />
      <VerificacionProvider>
        <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
      </VerificacionProvider>
    </>
  );
}
