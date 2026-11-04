import type { ReactNode } from 'react';
import type { Role } from '@electoral/shared';
import { getSession } from './session';

/** Bootstrap guard (owner: Meneses). */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const session = getSession();
  if (!session || !roles.includes(session.user.role)) {
    return (
      <main className="mx-auto max-w-md p-6 text-center">
        <h1 className="text-xl font-semibold">Sesión requerida</h1>
        <p className="mt-2 text-slate-600">Inicia sesión con tu usuario de jurado para continuar.</p>
      </main>
    );
  }
  return children;
}
