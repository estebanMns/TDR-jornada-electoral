import Link from 'next/link';
import { BarraPublica, Rotulo } from '@/shared/ui';
import { FormularioLogin } from './FormularioLogin';

export const metadata = { title: 'Ingresar' };

export default async function PaginaLogin({ searchParams }) {
  const { siguiente } = await searchParams;
  return (
    <>
    <BarraPublica />
    <main className="grid min-h-[calc(100dvh-57px)] place-items-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl border border-rejilla bg-hoja p-7">
          <Rotulo>Acceso del equipo electoral</Rotulo>
          <h1 className="mt-2 font-display text-2xl font-bold tracking-tight">Ingresa con tu usuario</h1>
          <p className="mt-1 text-sm text-tinta-suave">Jurados, auditores, coordinación y operación.</p>
          <FormularioLogin siguiente={siguiente} />
        </div>
        <p className="mt-5 text-center text-sm text-tinta-suave">
          ¿Solo quieres ver cómo va el conteo?{' '}
          <Link href="/resultados" className="font-medium text-indeleble underline-offset-4 hover:underline">
            Ver resultados
          </Link>
        </p>
      </div>
    </main>
    </>
  );
}
