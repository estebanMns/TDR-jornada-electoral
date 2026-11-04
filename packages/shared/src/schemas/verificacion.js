import { z } from 'zod';

/**
 * Formato de `verif:case:{acta}` (lo escribe Jose al encolar una dudosa;
 * `scripts/fake-dudosas.js` usa el mismo). Propuesta para `packages/shared`.
 */
export const casoVerificacionSchema = z.object({
  acta: z.string(),
  version: z.number().int().positive(),
  prioridad: z.number().int().min(1).max(3), // 1 = alta
  motivo: z.enum(['DESCUADRE', 'SUFRAGANTES_EXCEDEN', 'CONFLICTO']),
  mesa: z.number().int(),
  puesto: z.object({ id: z.number().int(), nombre: z.string() }),
  municipio: z.object({ id: z.number().int(), nombre: z.string() }),
  votos: z.record(z.string(), z.number().int().nonnegative()),
  sufragantes: z.number().int().nonnegative(),
  habilitados: z.number().int().nonnegative(),
  encoladaEn: z.number().int(), // ms epoch
});

/**
 * Score en `verif:queue`: primero prioridad (1 = alta), luego orden de llegada.
 * Menor score = se atiende antes.
 * @param {{ prioridad: number, encoladaEn: number }} caso
 */
export const scoreDeCaso = ({ prioridad, encoladaEn }) => prioridad * 1e13 + encoladaEn;

export const Decision = Object.freeze({
  APROBAR: 'APROBAR',
  APROBAR_CON_CORRECCION: 'APROBAR_CON_CORRECCION',
  RECHAZAR: 'RECHAZAR',
});

const acta = z.string().min(1).max(64);
const token = z.string().uuid();

/* ---------- Cliente → servidor (GENERAL §7.4) ---------- */

export const mensajeClienteSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('hola') }),
  z.object({ tipo: z.literal('tomar'), acta }),
  z.object({
    tipo: z.literal('latido'),
    /** ms epoch de la última interacción real (mouse/teclado/scroll). */
    actividad: z.number().int(),
    /** Aditivo: ms desde la última interacción (inmune al desfase de relojes). */
    inactivoMs: z.number().int().nonnegative().optional(),
    /** Caso que el cliente tiene tomado (sin estado en la instancia). */
    acta: acta.optional(),
    token: token.optional(),
  }),
  z
    .object({
      tipo: z.literal('resolver'),
      acta,
      token,
      decision: z.enum(Object.values(Decision)),
      votos: z.record(z.string(), z.number().int().nonnegative()).optional(),
      /** Aditivo: la corrección puede ajustar sufragantes (caso SUFRAGANTES_EXCEDEN). */
      sufragantes: z.number().int().nonnegative().optional(),
      motivo: z.string().trim().max(500).optional(),
    })
    .refine((m) => m.decision !== Decision.APROBAR_CON_CORRECCION || m.votos, {
      message: 'La corrección requiere votos',
      path: ['votos'],
    })
    .refine((m) => m.decision !== Decision.RECHAZAR || (m.motivo && m.motivo.length > 0), {
      message: 'El rechazo requiere motivo',
      path: ['motivo'],
    }),
  z.object({ tipo: z.literal('soltar'), acta, token }),
]);

/* ---------- Servidor → cliente (GENERAL §7.4 + aditivos marcados) ---------- */

export const MensajeServidor = Object.freeze({
  ESTADO_COLA: 'estado_cola',
  CASO_TOMADO: 'caso_tomado',
  CASO_LIBERADO: 'caso_liberado',
  CASO_NUEVO: 'caso_nuevo',
  CASO_RESUELTO: 'caso_resuelto',
  TOMADO_OK: 'tomado_ok',
  ERROR: 'error',
  PRESENCIA: 'presencia',
  /** Aditivo: confirmación de renovación del lease. */
  LOCK_RENOVADO: 'lock_renovado',
  /** Aditivo: estado de la plataforma (Redis ok/degradado) para deshabilitar acciones. */
  ESTADO: 'estado',
});

export const CodigoErrorVerificacion = Object.freeze({
  MENSAJE_INVALIDO: 'MENSAJE_INVALIDO',
  YA_TOMADO: 'YA_TOMADO',
  NO_EXISTE: 'NO_EXISTE',
  LOCK_PERDIDO: 'LOCK_PERDIDO',
  DESCUADRE: 'DESCUADRE',
  APLICACION_FALLIDA: 'APLICACION_FALLIDA',
  REDIS_NO_DISPONIBLE: 'REDIS_NO_DISPONIBLE',
  NO_AUTORIZADO: 'NO_AUTORIZADO',
});

/** Constantes del lease (GENERAL §9.3). */
export const LEASE = Object.freeze({
  TTL_MS: 30_000,
  LATIDO_MS: 10_000,
  INACTIVIDAD_MAX_MS: 5 * 60_000,
});
