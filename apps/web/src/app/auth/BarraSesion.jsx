'use client';

import Link from 'next/link';
import { Rol } from '@preconteo/shared/roles';
import { AlmacenCasoEnCurso } from '@/features/verificacion/net/AlmacenCasoEnCurso';

/** Barra superior de las consolas internas: navegación por rol y salida. */
export function BarraSesion({ usuario }) {
  async function salir() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    AlmacenCasoEnCurso.limpiar();
    window.location.assign('/login');
  }

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
        <span className="font-semibold">Preconteo</span>
        <nav className="flex gap-4 text-sm">
          <Link href="/verificacion" className="hover:underline">
            Cola
          </Link>
          {usuario.rol === Rol.COORDINADOR && (
            <Link href="/coordinacion" className="hover:underline">
              Coordinación
            </Link>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-slate-500">
            {usuario.nombre} · {usuario.rol.toLowerCase()}
          </span>
          <button
            onClick={salir}
            className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Salir
          </button>
        </div>
      </div>
    </header>
  );
}
