import { NextResponse } from 'next/server';
import { TokenService } from '@/server/core/auth/TokenService';
import { COOKIE_SESION } from '@/server/core/auth/credenciales';
import { reglaDeAcceso, inicioDe } from '@/app/auth/rutasProtegidas';

/**
 * Guardias por rol para las páginas (Next 16 `proxy`, antes `middleware`).
 * Solo decide a dónde va el navegador: las APIs y el WebSocket validan el JWT
 * por su cuenta (nunca confiar solo en el guard de la página).
 */
const tokens = new TokenService({ secreto: process.env.JWT_SECRET ?? '' });

export async function proxy(request) {
  const { pathname, search } = request.nextUrl;
  const usuario = await tokens.verificar(request.cookies.get(COOKIE_SESION)?.value);

  if (pathname === '/login') {
    return usuario ? redirigir(request, inicioDe(usuario.rol)) : NextResponse.next();
  }

  const regla = reglaDeAcceso(pathname);
  if (!regla) return NextResponse.next();

  if (!usuario) {
    const login = new URL('/login', request.url);
    login.searchParams.set('siguiente', `${pathname}${search}`);
    return NextResponse.redirect(login);
  }
  if (!regla.roles.includes(usuario.rol)) return redirigir(request, inicioDe(usuario.rol));
  return NextResponse.next();
}

function redirigir(request, ruta) {
  return NextResponse.redirect(new URL(ruta, request.url));
}

export const config = {
  matcher: [
    '/login',
    '/verificacion/:path*',
    '/coordinacion/:path*',
    '/ops/:path*',
    '/jurado/:path*',
  ],
};
