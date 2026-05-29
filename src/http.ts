/**
 * Internal HTTP transport.
 *
 * Sub-plan 21.1 row B-2. Wraps `fetch` with:
 *   - bearer auth + JSON content-type
 *   - optional X-Network header (the server infers it from the key's
 *     mode when omitted; we pass it when the caller pinned one)
 *   - hard timeout via AbortController
 *   - retry on 429 + 5xx with exponential backoff
 *   - structured error parsing
 *
 * Retry policy (per plan §5.2 + §6.1 AK-12):
 *   - Default: 3 retries, base 250ms, jittered, doubling each time.
 *   - 429 respects `Retry-After` (seconds) when present, else backoff.
 *   - 5xx retries unconditionally (transient).
 *   - 4xx (other than 429) is NOT retried - those are caller bugs.
 *   - POST /v1/payments opts out (row B-4) so a chain submission never
 *     accidentally double-spends on retry.
 */

import { ApiKeyError, Blockchain0xError, type Blockchain0xErrorBody } from './errors.js';

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  /** Query string params; values are URL-encoded. Falsy entries are dropped. */
  query?: Readonly<Record<string, string | number | undefined | null>>;
  /** Body for POST/PATCH. JSON-stringified by the transport. */
  body?: unknown;
  /**
   * Extra headers to send. The transport ALWAYS sets `Authorization`,
   * `Content-Type` (when body is present), `Accept`, and `User-Agent`.
   * Per-request callers add `Idempotency-Key` here.
   */
  headers?: Readonly<Record<string, string>>;
  /** Per-call retry override. Default = retry on 429/5xx. */
  retry?: 'default' | 'off';
  /** Override AbortController for tests. */
  signal?: AbortSignal;
}

export interface HttpConfig {
  apiKey: string;
  baseUrl: string;
  network: 'mainnet' | 'testnet' | undefined;
  timeoutMs: number;
  /** Test override. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
  /** Test override for backoff jitter. Defaults to Math.random. */
  rand?: () => number;
  /** Test override for sleep. Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

const USER_AGENT = '@blockchain0x/node 0.1.0-alpha.0';
const DEFAULT_MAX_RETRIES = 3;
const RETRY_BASE_MS = 250;
const RETRY_CAP_MS = 8_000;

function buildUrl(base: string, path: string, query: RequestOptions['query']): string {
  const url = new URL(`${base}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) {
        continue;
      }
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) {
    return null;
  }
  const secs = Number.parseInt(header, 10);
  return Number.isFinite(secs) && secs > 0 ? secs * 1000 : null;
}

function backoff(attempt: number, rand: () => number): number {
  // attempt is 1-indexed (1 = first retry). 250ms, 500ms, 1000ms with
  // 50% jitter, capped at 8s.
  const base = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_CAP_MS);
  return Math.floor(base * (0.5 + rand() * 0.5));
}

function isRetriable(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function isApiKeyCode(code: string): boolean {
  return code.startsWith('apikey.');
}

export function createHttpTransport(cfg: HttpConfig) {
  const fetchImpl = cfg.fetch ?? globalThis.fetch;
  const rand = cfg.rand ?? Math.random;
  const sleep = cfg.sleep ?? defaultSleep;

  return {
    async request<T>(opts: RequestOptions): Promise<T> {
      const url = buildUrl(cfg.baseUrl, opts.path, opts.query);
      const baseHeaders: Record<string, string> = {
        Authorization: `Bearer ${cfg.apiKey}`,
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        ...(cfg.network ? { 'X-Network': cfg.network } : {}),
        ...(opts.headers ?? {}),
      };
      const body =
        opts.body !== undefined && opts.body !== null
          ? typeof opts.body === 'string'
            ? opts.body
            : JSON.stringify(opts.body)
          : undefined;
      if (body !== undefined && !baseHeaders['Content-Type']) {
        baseHeaders['Content-Type'] = 'application/json';
      }

      const maxRetries = opts.retry === 'off' ? 0 : DEFAULT_MAX_RETRIES;
      let lastError: Blockchain0xError | undefined;
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        // Fresh AbortController per attempt so the per-call timeout
        // applies to each retry independently.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
        let res: Response;
        try {
          res = await fetchImpl(url, {
            method: opts.method,
            headers: baseHeaders,
            body,
            signal: opts.signal ?? controller.signal,
          });
        } catch (err) {
          clearTimeout(timer);
          // Network error (DNS, TLS, abort, etc.). Treat as retriable
          // 5xx-equivalent until retries exhaust.
          lastError = new Blockchain0xError({
            code: 'network.unreachable',
            message: err instanceof Error ? err.message : String(err),
            status: 0,
          });
          if (attempt < maxRetries) {
            await sleep(backoff(attempt + 1, rand));
            continue;
          }
          throw lastError;
        }
        clearTimeout(timer);

        if (res.status === 204) {
          return undefined as T;
        }
        const text = await res.text();
        if (res.status >= 200 && res.status < 300) {
          if (text.length === 0) {
            return undefined as T;
          }
          return JSON.parse(text) as T;
        }

        // Try to parse the error envelope; fall back to a synthetic
        // shape if the response is non-JSON (proxy / LB error pages).
        let envelope: Blockchain0xErrorBody | null = null;
        try {
          const parsed = JSON.parse(text) as { error?: Blockchain0xErrorBody };
          if (parsed && typeof parsed === 'object' && parsed.error) {
            envelope = parsed.error;
          }
        } catch {
          envelope = null;
        }
        const code = envelope?.code ?? `http.${res.status}`;
        const message = envelope?.message ?? `HTTP ${res.status}`;
        const requestId = envelope?.requestId ?? res.headers.get('x-request-id') ?? undefined;
        const details = envelope?.details;

        const ErrorCtor = isApiKeyCode(code) ? ApiKeyError : Blockchain0xError;
        lastError = new ErrorCtor({
          code,
          message,
          status: res.status,
          ...(requestId ? { requestId } : {}),
          ...(details !== undefined ? { details } : {}),
        });

        if (attempt < maxRetries && isRetriable(res.status)) {
          const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
          await sleep(retryAfter ?? backoff(attempt + 1, rand));
          continue;
        }
        throw lastError;
      }
      // Unreachable - the loop either returns or throws.
      throw (
        lastError ??
        new Blockchain0xError({
          code: 'internal.unhandled',
          message: 'transport reached an unreachable branch',
          status: 0,
        })
      );
    },
  };
}

export type HttpTransport = ReturnType<typeof createHttpTransport>;
