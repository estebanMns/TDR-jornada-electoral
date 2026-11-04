/**
 * Juror session. The platform login (apps/web, `/login`) stores the JWT in the
 * HttpOnly cookie `preconteo_sesion`, which this app cannot read: same-origin
 * requests carry it automatically, and `GET /api/auth/sesion` says who is
 * logged in. The user is cached so the app also opens offline (RT-6).
 *
 * In development `pnpm dev-token` provides a token through `#token=` instead.
 */
import type { JwtPayload, Role } from '@preconteo/contracts';

const DEV_TOKEN_KEY = 'electoral.token';
const USER_CACHE_KEY = 'electoral.user';

export interface Session {
  /** Only in development; with the platform login the cookie authenticates. */
  token: string | null;
  user: JwtPayload;
}

/** Platform role names (Spanish) → contract roles. */
const ROLE_BY_PLATFORM_ROLE: Record<string, Role> = {
  JURADO: 'JUROR',
  AUDITOR: 'AUDITOR',
  COORDINADOR: 'COORDINATOR',
  ADMIN: 'ADMIN',
};

let current: Session | null = null;

export function getSession(): Session | null {
  return current;
}

function normalizeUser(claims: Record<string, unknown>): JwtPayload | null {
  const rawRole = claims.rol ?? claims.role;
  if (typeof claims.sub !== 'string' || typeof rawRole !== 'string') return null;
  const role = ROLE_BY_PLATFORM_ROLE[rawRole] ?? (rawRole as Role);
  const tableId = claims.mesa ?? claims.tableId;
  const name = claims.nombre ?? claims.name;
  return {
    sub: claims.sub,
    role,
    name: typeof name === 'string' ? name : claims.sub,
    ...(typeof tableId === 'number' ? { tableId } : {}),
  };
}

function decodeToken(token: string): (Record<string, unknown> & { exp?: number }) | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function fromDevToken(): Session | null {
  const token = localStorage.getItem(DEV_TOKEN_KEY);
  const claims = token ? decodeToken(token) : null;
  if (!token || !claims || (claims.exp !== undefined && claims.exp * 1_000 < Date.now())) return null;
  const user = normalizeUser(claims);
  return user ? { token, user } : null;
}

/** Resolves the session once at start-up. */
export async function loadSession(): Promise<Session | null> {
  current = fromDevToken();
  if (current) return current;

  try {
    const response = await fetch('/api/auth/sesion', { credentials: 'same-origin', cache: 'no-store' });
    if (response.ok) {
      const { usuario } = (await response.json()) as { usuario: Record<string, unknown> };
      const user = normalizeUser(usuario);
      if (user) localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
      current = user ? { token: null, user } : null;
      return current;
    }
    if (response.status === 401 || response.status === 403) {
      localStorage.removeItem(USER_CACHE_KEY);
      return (current = null);
    }
  } catch {
    // Offline: fall back to the cached user below.
  }
  const cached = readJson<JwtPayload>(USER_CACHE_KEY);
  current = cached ? { token: null, user: cached } : null;
  return current;
}

/**
 * Cierra la sesión: borra la cookie en el servidor y lo guardado en el teléfono.
 * Las actas que sigan en cola NO se borran (están en IndexedDB y se envían al volver a entrar).
 */
export async function logout(): Promise<void> {
  localStorage.removeItem(DEV_TOKEN_KEY);
  localStorage.removeItem(USER_CACHE_KEY);
  current = null;
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
  window.location.assign('/login');
}

/**
 * DEVELOPMENT ONLY: accepts `#token=<jwt>` (printed by `pnpm dev-token`).
 * Stripped from production builds.
 */
export function adoptDevTokenFromUrl(): void {
  if (!import.meta.env.DEV) return;
  const match = /[#&]token=([^&]+)/.exec(window.location.hash);
  if (!match?.[1]) return;
  localStorage.setItem(DEV_TOKEN_KEY, decodeURIComponent(match[1]));
  history.replaceState(null, '', window.location.pathname + window.location.search);
}
