/**
 * Bootstrap app shell (owner: Meneses). Stateless session: the JWT is kept in
 * localStorage and its payload decoded locally (the server validates it).
 */
import type { JwtPayload } from '@electoral/shared';

const SESSION_KEY = 'electoral.token';

export interface Session {
  token: string;
  user: JwtPayload & { exp?: number };
}

function decodePayload(token: string): Session['user'] | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as Session['user'];
  } catch {
    return null;
  }
}

export function getSession(): Session | null {
  const token = localStorage.getItem(SESSION_KEY);
  if (!token) return null;
  const user = decodePayload(token);
  if (!user || (user.exp !== undefined && user.exp * 1_000 < Date.now())) return null;
  return { token, user };
}

export function saveToken(token: string): void {
  localStorage.setItem(SESSION_KEY, token);
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

/**
 * DEVELOPMENT ONLY: accepts `#token=<jwt>` (printed by `pnpm dev-token`) until
 * the login screen exists. Stripped from production builds.
 */
export function adoptDevTokenFromUrl(): void {
  if (!import.meta.env.DEV) return;
  const match = /[#&]token=([^&]+)/.exec(window.location.hash);
  if (!match?.[1]) return;
  saveToken(decodeURIComponent(match[1]));
  history.replaceState(null, '', window.location.pathname + window.location.search);
}
