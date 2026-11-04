import { usuarioActualORedirigir } from '@/app/auth/sesionServidor';
import { BarraSesion } from '@/app/auth/BarraSesion';
import OpsPage from '@/features/ops/OpsPage';

export const metadata = { title: 'Operación' };

export default async function Pagina() {
  const usuario = await usuarioActualORedirigir();
  return (
    <>
      <BarraSesion usuario={usuario} />
      <OpsPage />
    </>
  );
}
