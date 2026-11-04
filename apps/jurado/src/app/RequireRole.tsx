import { useEffect, useState, type ReactNode } from 'react';
import type { Role } from '@preconteo/contracts';
import { loadSession, type Session } from './session';

/** Login screen of the platform (apps/web). */
const LOGIN_URL = '/login';

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const [session, setSession] = useState<Session | null | 'loading'>('loading');

  useEffect(() => {
    void loadSession().then(setSession);
  }, []);

  if (session === 'loading') return <p className="p-6 text-slate-500">Cargando…</p>;
  if (!session || !roles.includes(session.user.role)) {
    return (
      <main className="mx-auto max-w-md p-6 text-center">
        <h1 className="text-xl font-semibold">Sesión requerida</h1>
        <p className="mt-2 text-slate-600">Inicia sesión con tu usuario de jurado para continuar.</p>
        <a href={LOGIN_URL} className="mt-4 inline-block rounded-lg bg-blue-700 px-4 py-2 font-medium text-white">
          Iniciar sesión
        </a>
      </main>
    );
  }
  return children;
}
