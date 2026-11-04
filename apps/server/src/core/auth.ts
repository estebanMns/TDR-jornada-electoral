/**
 * Bootstrap core (platform owner: Meneses). Stateless JWT (HS256) validation
 * and a role guard. Login lives in the platform module.
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

export const authPlugin = fp<{ secret: string }>(async (app, { secret }) => {
  await app.register(fastifyJwt, { secret, sign: { expiresIn: JWT_EXPIRATION } });
});

export type Authorize = (...roles: Role[]) => preHandlerAsyncHookHandler;

/** preHandler that requires a valid token with one of `roles`. */
export const authorize: Authorize =
  (...roles) =>
  async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }
    if (!roles.includes(request.user.role)) {
      return reply.code(403).send({ error: 'FORBIDDEN' });
    }
  };
