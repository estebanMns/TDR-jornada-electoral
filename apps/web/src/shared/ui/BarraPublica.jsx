'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { INICIO_POR_ROL } from '@preconteo/shared/roles';
import { Marca } from './Marca';

const ENLACES = [
  { href: '/', texto: 'Inicio' },
  { href: '/resultados', texto: 'Resultados' },
  { href: '/#como-funciona', texto: 'Cómo funciona', soloAncho: true },
];

/**
 * Barra de navegación de las páginas públicas (portada, resultados, login).
 * Si hay una sesión abierta, el botón lleva al panel del rol en vez de al login.
 */
export function BarraPublica({ derecha = null }) {
  const ruta = usePathname();
  const [panel, setPanel] = useState(null);

  useEffect(() => {
    fetch('/api/auth/sesion', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((datos) => {
        const rol = datos?.usuario?.rol;
        if (rol && INICIO_POR_ROL[rol]) setPanel(INICIO_POR_ROL[rol]);
      })
      .catch(() => {});
  }, []);

  return (
    <header className="sticky top-0 z-20 border-b border-rejilla bg-hoja/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2.5 sm:gap-4">
        <Link href="/" aria-label="Mesa a Mesa, inicio" className="mr-1 shrink-0">
          <Marca className="text-base sm:text-lg" soloIconoEnMovil />
        </Link>
        <nav aria-label="Principal" className="flex min-w-0 items-center gap-0.5 text-sm font-medium">
          {ENLACES.map(({ href, texto, soloAncho }) => {
            const activo = href === ruta;
            return (
              <Link
                key={href}
                href={href}
                aria-current={activo ? 'page' : undefined}
                className={`rounded-lg px-2 py-1.5 transition sm:px-2.5 ${soloAncho ? 'hidden md:inline-block' : ''} ${
                  activo ? 'bg-indeleble-claro text-indeleble' : 'text-tinta-suave hover:text-tinta'
                }`}
              >
                {texto}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {derecha && <div className="hidden sm:block">{derecha}</div>}
          <Link
            href={panel ?? '/login'}
            className="rounded-lg border border-rejilla px-3 py-1.5 text-sm font-semibold transition hover:border-indeleble"
          >
            {panel ? 'Mi panel' : 'Ingresar'}
          </Link>
        </div>
      </div>
      {derecha && <div className="flex justify-end border-t border-rejilla px-4 py-1.5 sm:hidden">{derecha}</div>}
    </header>
  );
}
