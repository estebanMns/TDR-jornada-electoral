/**
 * Acceso a la tabla `usuarios` de Supabase. Es la única consulta a Supabase en el
 * flujo de un usuario (login); el resto valida el JWT localmente.
 */
export class UsuariosRepository {
  /** @param {{ supabase: import('@supabase/supabase-js').SupabaseClient }} deps */
  constructor({ supabase }) {
    this.supabase = supabase;
  }

  /**
   * @param {string} username
   * @returns {Promise<{ id: string, username: string, password_hash: string, rol: string,
   *                     nombre: string, mesa: number|null } | null>}
   */
  async buscarPorUsername(username) {
    const { data, error } = await this.supabase
      .from('usuarios')
      .select('id, username, password_hash, rol, nombre, mesa')
      .eq('username', username)
      .maybeSingle()
      // Sin reintentos automáticos (1 s + 2 s + 4 s): el login falla rápido y el usuario reintenta.
      .retry(false);
    if (error) throw new Error(`Supabase usuarios: ${error.message}`);
    return data;
  }
}
