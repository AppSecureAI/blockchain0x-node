/**
 * HTTP transport tests (sub-plan 21.1 row B-2).
 *
 * Drives the transport against a fake fetch + deterministic sleep so
 * the retry / structured-error / header behaviour is pinned without a
 * running server.
 */

import { describe, it, expect, vi } from 'vitest';
import { createHttpTransport } from './http.js';
import { ApiKeyError, Blockchain0xError } from './errors.js';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function emptyResponse(status: number, headers: Record<string, string> = {}) {
  return new Response(null, { status, headers });
}

const cfgBase = {
  apiKey: 'sk_test_demo',
  baseUrl: 'https://api.test',
  network: undefined as 'mainnet' | 'testnet' | undefined,
  timeoutMs: 1_000,
  sleep: async () => undefined,
  rand: () => 0.5,
};

describe('http transport', () => {
  it('sends Authorization + Accept + User-Agent and parses 200 JSON', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { ok: true }));
    const http = createHttpTransport({ ...cfgBase, fetch });
    const body = await http.request<{ ok: boolean }>({ method: 'GET', path: '/v1/agents' });
    expect(body).toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.test/v1/agents');
    expect((init as RequestInit).method).toBe('GET');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk_test_demo');
    expect(headers.Accept).toBe('application/json');
    expect(headers['User-Agent']).toMatch(/blockchain0x\/node/);
    expect(headers['X-Network']).toBeUndefined();
  });

  it('sets X-Network when the client pinned one', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, {}));
    const http = createHttpTransport({ ...cfgBase, network: 'testnet', fetch });
    await http.request({ method: 'GET', path: '/v1/agents' });
    const headers = (fetch.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Network']).toBe('testnet');
  });

  it('serializes a JSON body and sets Content-Type', async () => {
    const fetch = vi.fn(async () => jsonResponse(201, { id: 'x' }));
    const http = createHttpTransport({ ...cfgBase, fetch });
    await http.request({ method: 'POST', path: '/v1/agents', body: { name: 'a' } });
    const init = fetch.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBe('{"name":"a"}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('returns undefined on 204', async () => {
    const fetch = vi.fn(async () => emptyResponse(204));
    const http = createHttpTransport({ ...cfgBase, fetch });
    const res = await http.request({ method: 'DELETE', path: '/v1/api-keys/k' });
    expect(res).toBeUndefined();
  });

  it('throws ApiKeyError when the envelope code starts with apikey.', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(403, {
        error: { code: 'apikey.agent_mismatch', message: 'wrong agent', requestId: 'req_1' },
      })
    );
    const http = createHttpTransport({ ...cfgBase, fetch });
    await expect(http.request({ method: 'GET', path: '/v1/agents/x' })).rejects.toThrow(
      ApiKeyError
    );
    try {
      await http.request({ method: 'GET', path: '/v1/agents/x' });
    } catch (e) {
      const err = e as ApiKeyError;
      expect(err.code).toBe('apikey.agent_mismatch');
      expect(err.status).toBe(403);
      expect(err.requestId).toBe('req_1');
    }
  });

  it('throws Blockchain0xError for non-apikey envelope codes', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(400, { error: { code: 'request.invalid', message: 'bad' } })
    );
    const http = createHttpTransport({ ...cfgBase, fetch });
    await expect(http.request({ method: 'GET', path: '/v1/x' })).rejects.toMatchObject({
      name: 'Blockchain0xError',
      code: 'request.invalid',
      status: 400,
    });
  });

  it('synthesises code/message when the upstream is non-JSON (e.g. LB error page)', async () => {
    const fetch = vi.fn(async () => new Response('<html>502 Bad Gateway</html>', { status: 502 }));
    const http = createHttpTransport({ ...cfgBase, fetch, sleep: async () => undefined });
    // 502 retries until exhausted; eventually throws the synthetic code.
    await expect(http.request({ method: 'GET', path: '/v1/x' })).rejects.toMatchObject({
      code: 'http.502',
      status: 502,
    });
    expect(fetch).toHaveBeenCalledTimes(4); // 1 + 3 retries
  });

  it('retries on 500 and resolves when the next attempt succeeds', async () => {
    const sleep = vi.fn(async () => undefined);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(500, { error: { code: 'internal.unhandled', message: 'x' } })
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const http = createHttpTransport({ ...cfgBase, fetch, sleep });
    const out = await http.request<{ ok: boolean }>({ method: 'GET', path: '/v1/x' });
    expect(out).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 respecting Retry-After (seconds) when present', async () => {
    const sleep = vi.fn(async () => undefined);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 'rate_limit.exceeded', message: '429' } }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '2' },
        })
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const http = createHttpTransport({ ...cfgBase, fetch, sleep });
    await http.request({ method: 'GET', path: '/v1/x' });
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it('does NOT retry 4xx (other than 429)', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(403, { error: { code: 'apikey.scope_insufficient', message: 'no scope' } })
    );
    const http = createHttpTransport({ ...cfgBase, fetch });
    await expect(http.request({ method: 'GET', path: '/v1/x' })).rejects.toMatchObject({
      status: 403,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('honours retry: "off"', async () => {
    const fetch = vi.fn(async () => jsonResponse(500, { error: { code: 'x', message: 'x' } }));
    const http = createHttpTransport({ ...cfgBase, fetch });
    await expect(
      http.request({ method: 'POST', path: '/v1/payments', body: {}, retry: 'off' })
    ).rejects.toMatchObject({ status: 500 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('builds query strings, dropping null/undefined entries', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, {}));
    const http = createHttpTransport({ ...cfgBase, fetch });
    await http.request({
      method: 'GET',
      path: '/v1/x',
      query: { a: 1, b: undefined, c: 'two', d: null },
    });
    const url = fetch.mock.calls[0]![0] as string;
    expect(url).toBe('https://api.test/v1/x?a=1&c=two');
  });

  it('wraps network errors as Blockchain0xError(code: network.unreachable) and retries', async () => {
    const sleep = vi.fn(async () => undefined);
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const http = createHttpTransport({ ...cfgBase, fetch, sleep });
    await http.request({ method: 'GET', path: '/v1/x' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('throws Blockchain0xError(network.unreachable) when retries exhaust on network error', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('econnrefused');
    });
    const http = createHttpTransport({ ...cfgBase, fetch, sleep: async () => undefined });
    await expect(http.request({ method: 'GET', path: '/v1/x' })).rejects.toBeInstanceOf(
      Blockchain0xError
    );
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
