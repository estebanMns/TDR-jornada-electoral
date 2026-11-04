import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { TokenService } from '@/server/core/auth/TokenService';
import { COOKIE_SESION } from '@/server/core/auth/credenciales';

const tokens = new TokenService({ secreto: process.env.JWT_SECRET ?? '' });

/** Usuario de la sesión actual en un Server Component, o redirige al login. */
export async function usuarioActualORedirigir() {
  const almacen = await cookies();
  const usuario = await tokens.verificar(almacen.get(COOKIE_SESION)?.value);
  if (!usuario) redirect('/login');
  return usuario;
}
