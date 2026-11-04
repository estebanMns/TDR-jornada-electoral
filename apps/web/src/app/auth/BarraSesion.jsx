'use client';

import Link from 'next/link';
import { Rol } from '@preconteo/shared/roles';
import { Marca } from '@/shared/ui';
import { AlmacenCasoEnCurso } from '@/features/verificacion/net/AlmacenCasoEnCurso';

/** Barra superior de las consolas internas: navegación por rol y salida. */
export function BarraSesion({ usuario }) {
  async function salir() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    AlmacenCasoEnCurso.limpiar();
    window.location.assign('/login');
  }

  return (
    <header className="sticky top-0 z-10 border-b border-rejilla bg-hoja/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
        <Link href="/" aria-label="Inicio">
          <Marca className="text-base" />
        </Link>
        <nav className="flex gap-4 text-sm">
          {(usuario.rol === Rol.AUDITOR || usuario.rol === Rol.COORDINADOR) && (
            <Link href="/verificacion" className="hover:underline">
              Cola
            </Link>
          )}
          {usuario.rol === Rol.ADMIN && (
            <Link href="/ops" className="hover:underline">
              Operación
            </Link>
          )}
          <Link href="/resultados" className="hover:underline">
            Resultados
          </Link>
          {usuario.rol === Rol.COORDINADOR && (
            <Link href="/coordinacion" className="hover:underline">
              Coordinación
            </Link>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-tinta-suave">
            {usuario.nombre} · {usuario.rol.toLowerCase()}
          </span>
          <button
            onClick={salir}
            className="rounded-lg border border-rejilla px-3 py-1 hover:border-indeleble"
          >
            Salir
          </button>
        </div>
      </div>
    </header>
  );
}
