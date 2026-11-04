import { createClient } from '@supabase/supabase-js';

/**
 * Cliente de Supabase con la clave service_role. Solo vive en el servidor.
 * Cada petición tiene tiempo máximo: Supabase nunca debe colgar una respuesta.
 * @param {{ url: string, claveServicio: string, tiempoMaximoMs?: number }} config
 */
export function crearClienteSupabase({ url, claveServicio, tiempoMaximoMs = 3_000 }) {
  const fetchConTiempoMaximo = (entrada, opciones = {}) => {
    const limite = AbortSignal.timeout(tiempoMaximoMs);
    const signal = opciones.signal ? AbortSignal.any([opciones.signal, limite]) : limite;
    return fetch(entrada, { ...opciones, signal });
  };
  return createClient(url, claveServicio, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchConTiempoMaximo },
  });
}
