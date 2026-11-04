/**
 * Minimal HTTP client with explicit failure kinds (owner: Jose). Every
 * attempt has a timeout: on a bad mobile network a hung request must turn
 * into a retry, never into a frozen screen.
 */

/** The request never got an HTTP answer (offline, DNS, connection reset…). */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super('Network unavailable', { cause });
    this.name = 'NetworkError';
  }
}

/** No answer within the time budget. The server may or may not have processed it. */
export class TimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`No response after ${timeoutMs} ms`);
    this.name = 'TimeoutError';
  }
}

export interface HttpRequest {
  method?: 'GET' | 'POST' | 'PUT';
  token?: string;
  headers?: Record<string, string>;
  /** Objects are sent as JSON; Blobs as-is. */
  body?: unknown;
  timeoutMs?: number;
}

export interface HttpResponse<T> {
  status: number;
  headers: Headers;
  body: T | null;
}

export const DEFAULT_TIMEOUT_MS = 10_000;

export async function httpRequest<T>(url: string, request: HttpRequest = {}): Promise<HttpResponse<T>> {
  const { method = 'GET', token, timeoutMs = DEFAULT_TIMEOUT_MS } = request;
  const headers: Record<string, string> = { ...request.headers };
  if (token) headers.authorization = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (request.body instanceof Blob) {
    body = request.body;
    headers['content-type'] ??= request.body.type || 'application/octet-stream';
  } else if (request.body !== undefined) {
    body = JSON.stringify(request.body);
    headers['content-type'] = 'application/json';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, { method, headers, body, signal: controller.signal, cache: 'no-store' });
  } catch (error) {
    if (controller.signal.aborted) throw new TimeoutError(timeoutMs);
    throw new NetworkError(error);
  } finally {
    clearTimeout(timer);
  }

  const isJson = response.headers.get('content-type')?.includes('application/json') ?? false;
  const parsed = isJson ? ((await response.json().catch(() => null)) as T | null) : null;
  return { status: response.status, headers: response.headers, body: parsed };
}
