/**
 * Minimal types for the platform contracts (packages/shared is JavaScript).
 * Only what the contract tests use.
 */
declare module '@preconteo/shared/schemas/verificacion' {
  export interface CasoVerificacion {
    acta: string;
    version: number;
    prioridad: number;
    motivo: 'DESCUADRE' | 'SUFRAGANTES_EXCEDEN' | 'CONFLICTO';
    mesa: number;
    puesto: { id: number; nombre: string };
    municipio: { id: number; nombre: string };
    votos: Record<string, number>;
    sufragantes: number;
    habilitados: number;
    encoladaEn: number;
  }

  export const casoVerificacionSchema: {
    safeParse(value: unknown):
      | { success: true; data: CasoVerificacion; error?: undefined }
      | { success: false; data?: undefined; error: { issues: unknown[] } };
  };

  export function scoreDeCaso(caso: Pick<CasoVerificacion, 'prioridad' | 'encoladaEn'>): number;
}
