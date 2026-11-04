import { createHmac } from 'node:crypto';
import type { JwtPayload } from '@electoral/shared';

/**
 * HS256 token equivalent to the one issued by the login endpoint.
 * DEVELOPMENT ONLY: signs with the local JWT_SECRET.
 */
export function signDevToken(payload: JwtPayload, secret: string, ttlSeconds = 8 * 3_600): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1_000);
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const body = encode({ ...payload, iat: now, exp: now + ttlSeconds });
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function devJurorPayload(tableId: number): JwtPayload {
  return { sub: `juror-${String(tableId).padStart(4, '0')}`, role: 'JUROR', name: `Jurado mesa ${tableId}`, tableId };
}

export function devSecret(): string {
  return process.env.JWT_SECRET ?? 'change-me-dev-only';
}
