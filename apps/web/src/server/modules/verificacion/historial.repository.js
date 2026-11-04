/**
 * Registro durable de decisiones en Supabase (`verificaciones`) y acceso a fotos.
 * Supabase NO está en el camino crítico: un fallo aquí se registra pero no
 * deshace una resolución ya aplicada en Redis.
 */
export class HistorialVerificacionRepository {
  /**
   * @param {{ supabase: import('@supabase/supabase-js').SupabaseClient, bucketFotos: string,
   *           logger: import('pino').Logger }} deps
   */
  constructor({ supabase, bucketFotos, logger }) {
    this.supabase = supabase;
    this.bucketFotos = bucketFotos;
    this.logger = logger.child({ componente: 'historial-verificacion' });
  }

  /** @returns {Promise<boolean>} true si quedó persistida */
  async registrarDecision({ acta, version, auditor, decision, votosCorregidos, motivo, fencing }) {
    const { error } = await this.supabase.from('verificaciones').insert({
      acta_id: acta,
      version,
      auditor,
      decision,
      votos_corregidos: votosCorregidos ?? null,
      motivo: motivo ?? null,
      fencing,
      creado_en: new Date().toISOString(),
    });
    if (error) {
      this.logger.error(
        { err: error.message, acta, fencing },
        'no se pudo persistir la verificación',
      );
      return false;
    }
    return true;
  }

  /** URL firmada de 60 s para la foto `{acta}/v{version}.jpg`. */
  async urlFirmadaFoto(acta, version, segundos = 60) {
    const { data, error } = await this.supabase.storage
      .from(this.bucketFotos)
      .createSignedUrl(`${acta}/v${version}.jpg`, segundos);
    if (error) return null;
    return data.signedUrl;
  }
}
