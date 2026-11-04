import { useEffect, useState, type ReactNode } from 'react';
import type { Role } from '@preconteo/contracts';
import { loadSession, type Session } from './session';
import { Marca, Rotulo } from '../shared/ui/Marca';

/** Login screen of the platform (apps/web). */
const LOGIN_URL = '/login';

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const [session, setSession] = useState<Session | null | 'loading'>('loading');

  useEffect(() => {
    void loadSession().then(setSession);
  }, []);

  if (session === 'loading') return <p className="p-6 text-tinta-suave">Cargando…</p>;
  if (!session || !roles.includes(session.user.role)) {
    return (
      <main className="grid min-h-dvh place-items-center px-5 py-10">
        <div className="w-full max-w-sm">
          <a href="/" aria-label="Inicio">
            <Marca />
          </a>
          <div className="mt-6 rounded-2xl border border-rejilla bg-hoja p-7">
            <Rotulo>Transmisión del acta E-14</Rotulo>
            <h1 className="mt-2 font-display text-2xl font-bold tracking-tight">Ingresa con tu usuario de jurado</h1>
            <p className="mt-2 text-tinta-suave">
              Cada jurado transmite el acta de su mesa. Tu usuario es el número de la mesa, por ejemplo{' '}
              <span className="font-mono">jurado0042</span>.
            </p>
            <a
              href={`${LOGIN_URL}?siguiente=/jurado/`}
              className="mt-6 block rounded-xl bg-indeleble py-3 text-center font-semibold text-white dark:text-papel"
            >
              Ingresar
            </a>
          </div>
        </div>
      </main>
    );
  }
  return children;
}
