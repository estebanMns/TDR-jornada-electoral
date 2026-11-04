import { FormularioLogin } from './FormularioLogin';

export const metadata = { title: 'Ingresar · Preconteo' };

export default async function PaginaLogin({ searchParams }) {
  const { siguiente } = await searchParams;
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-xl font-semibold">Preconteo electoral</h1>
        <p className="mt-1 text-sm text-slate-500">Ingresa con el usuario asignado.</p>
        <FormularioLogin siguiente={siguiente} />
      </div>
    </main>
  );
}
