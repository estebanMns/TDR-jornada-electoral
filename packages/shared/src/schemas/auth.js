import { z } from 'zod';
import { ROLES } from '../roles.js';

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
});

/** Contenido del JWT (GENERAL §4). */
export const jwtPayloadSchema = z.object({
  sub: z.string(),
  rol: z.enum(ROLES),
  nombre: z.string(),
  mesa: z.number().int().nullable().optional(),
});

/** Usuario público que devuelve el login (sin hash). */
export const usuarioPublicoSchema = jwtPayloadSchema;
