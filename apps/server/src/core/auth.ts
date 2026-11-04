/**
 * Stateless JWT (HS256) validation and a role guard for the actas service.
 *
 * Tokens are issued by the platform login (apps/web): claims `rol`, `nombre`,
 * `mesa`, delivered in the `Authorization` header or the `preconteo_sesion`
 * HttpOnly cookie. They are normalized here to the English `JwtPayload` of
 * `@preconteo/contracts`, so the module code does not depend on that format.
 */
import fastifyJwt from '@fastify/jwt';
import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { JwtPayload, Role } from '@preconteo/contracts';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

export const JWT_EXPIRATION = '8h';

/** Cookie set by the platform login (apps/web/src/server/core/auth/credenciales.js). */
export const SESSION_COOKIE = 'preconteo_sesion';

/** Platform role names (Spanish) → contract roles. */
const ROLE_BY_PLATFORM_ROLE: Record<string, Role> = {
  JURADO: 'JUROR',
  AUDITOR: 'AUDITOR',
  COORDINADOR: 'COORDINATOR',
  ADMIN: 'ADMIN',
};

const KNOWN_ROLES = new Set<string>(Object.values(ROLE_BY_PLATFORM_ROLE));

export const authPlugin = fp<{ secret: string }>(async (app, { secret }) => {
  await app.register(fastifyJwt, { secret, sign: { expiresIn: JWT_EXPIRATION } });
});

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

function extractToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) return authorization.slice('Bearer '.length).trim();
  return readCookie(request.headers.cookie, SESSION_COOKIE);
}

/** Accepts both the platform claims (`rol`, `nombre`, `mesa`) and the contract claims. */
export function normalizeClaims(claims: Record<string, unknown>): JwtPayload | null {
  const sub = claims.sub;
  const rawRole = (claims.rol ?? claims.role) as unknown;
  if (typeof sub !== 'string' || typeof rawRole !== 'string') return null;
  const role = ROLE_BY_PLATFORM_ROLE[rawRole] ?? (KNOWN_ROLES.has(rawRole) ? (rawRole as Role) : null);
  if (!role) return null;
  const tableId = claims.mesa ?? claims.tableId;
  const name = claims.nombre ?? claims.name;
  return {
    sub,
    role,
    name: typeof name === 'string' ? name : sub,
    ...(typeof tableId === 'number' ? { tableId } : {}),
  };
}

export type Authorize = (...roles: Role[]) => preHandlerAsyncHookHandler;

/** preHandler that requires a valid token with one of `roles`. */
export const authorize: Authorize =
  (...roles) =>
  async (request: FastifyRequest, reply: FastifyReply) => {
    const token = extractToken(request);
    let user: JwtPayload | null = null;
    if (token) {
      try {
        user = normalizeClaims(request.server.jwt.verify<Record<string, unknown>>(token));
      } catch {
        user = null;
      }
    }
    if (!user) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    if (!roles.includes(user.role)) return reply.code(403).send({ error: 'FORBIDDEN' });
    request.user = user;
  };
