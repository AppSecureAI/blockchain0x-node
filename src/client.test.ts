/**
 * Client + resource tests (sub-plan 21.1 row B-2).
 *
 * Pins the public surface (shape + path routing) by driving the client
 * through a fake fetch. Wire-level retry behaviour is covered by
 * `http.test.ts`; this file focuses on resource glue.
 */

import { describe, it, expect, vi } from 'vitest';
import { createClient } from './client.js';
import { ApiKeyError, Blockchain0xError } from './errors.js';

function ok<T>(body: T, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function build(fetchImpl: typeof globalThis.fetch) {
  return createClient({
    apiKey: 'sk_test_demo',
    baseUrl: 'https://api.test',
    network: 'testnet',
    timeoutMs: 1_000,
    _transport: { fetch: fetchImpl, sleep: async () => undefined, rand: () => 0.5 },
  });
}

describe('createClient.agents', () => {
  it('GET /v1/agents/:id', async () => {
    const fetch = vi.fn(async () =>
      ok({ id: 'agt_1', name: 'Bot', network: 'testnet', disabled: false })
    );
    const client = build(fetch);
    const a = await client.agents.get('agt_1');
    expect(a.id).toBe('agt_1');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.test/v1/agents/agt_1');
    expect((init as RequestInit).method).toBe('GET');
  });

  it('GET /v1/agents with cursor + limit', async () => {
    const fetch = vi.fn(async () => ok({ data: [], page: { next: null, prev: null } }));
    const client = build(fetch);
    await client.agents.list({ cursor: 'c1', limit: 25 });
    expect(fetch.mock.calls[0]![0]).toBe('https://api.test/v1/agents?cursor=c1&limit=25');
  });

  it('throws ApiKeyError when the agent-mismatch envelope comes back', async () => {
    const fetch = vi.fn(async () =>
      ok({ error: { code: 'apikey.agent_mismatch', message: 'wrong agent' } }, 403)
    );
    const client = build(fetch);
    await expect(client.agents.get('agt_other')).rejects.toBeInstanceOf(ApiKeyError);
  });
});

describe('createClient.apiKeys', () => {
  it('POST /v1/api-keys with body', async () => {
    const fetch = vi.fn(async () =>
      ok({
        id: 'ak_1',
        prefix: 'sk_test_abc',
        label: 'k',
        scopes: ['read_wallet_metadata'],
        agentId: null,
        secret: 'sk_test_REVEALED',
      })
    );
    const client = build(fetch);
    const key = await client.apiKeys.create({ label: 'k', scopes: ['read_wallet_metadata'] });
    expect(key.secret).toBe('sk_test_REVEALED');
    const init = fetch.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"label":"k","scopes":["read_wallet_metadata"]}');
  });

  it('DELETE /v1/api-keys/:id resolves on 204', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const client = build(fetch);
    await expect(client.apiKeys.revoke('ak_1')).resolves.toBeUndefined();
  });

  it('GET /v1/api-keys/usage forwards windowDays + agentId', async () => {
    const fetch = vi.fn(async () =>
      ok({
        windowDays: 30,
        granularity: 'day',
        series: [],
        totals: { calls: 0, errors: 0 },
        scope: { workspaceId: 'ws_1', agentId: null, apiKeyId: null },
      })
    );
    const client = build(fetch);
    await client.apiKeys.usage({ windowDays: 7, agentId: 'agt_1' });
    expect(fetch.mock.calls[0]![0]).toBe(
      'https://api.test/v1/api-keys/usage?windowDays=7&agentId=agt_1'
    );
  });
});

describe('createClient.webhooks', () => {
  it('GET /v1/webhooks with cursor + limit + agentId', async () => {
    const fetch = vi.fn(async () => ok({ data: [], page: { next: null, prev: null } }));
    const client = build(fetch);
    await client.webhooks.list({ cursor: 'c', limit: 5, agentId: 'agt_a' });
    expect(fetch.mock.calls[0]![0]).toBe(
      'https://api.test/v1/webhooks?cursor=c&limit=5&agentId=agt_a'
    );
  });

  it('POST /v1/webhooks - returns the signingSecret once', async () => {
    const fetch = vi.fn(async () =>
      ok(
        {
          id: 'wh_1',
          url: 'https://example/wh',
          events: ['payment.received'],
          agentId: null,
          signingSecret: 'whsk_DEMO',
          active: true,
        },
        201
      )
    );
    const client = build(fetch);
    const wh = await client.webhooks.create({
      url: 'https://example/wh',
      events: ['payment.received'],
    });
    expect(wh.signingSecret).toBe('whsk_DEMO');
    const init = fetch.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"url":"https://example/wh","events":["payment.received"]}');
  });

  it('PATCH /v1/webhooks/:id forwards the patch shape', async () => {
    const fetch = vi.fn(async () =>
      ok({
        id: 'wh_1',
        url: 'https://example/wh',
        events: ['payment.sent'],
        agentId: null,
        signingSecret: null,
        active: false,
      })
    );
    const client = build(fetch);
    const wh = await client.webhooks.update('wh_1', { active: false });
    expect(wh.active).toBe(false);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.test/v1/webhooks/wh_1');
    expect((init as RequestInit).method).toBe('PATCH');
    expect((init as RequestInit).body).toBe('{"active":false}');
  });

  it('DELETE /v1/webhooks/:id resolves on 204', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const client = build(fetch);
    await expect(client.webhooks.delete('wh_1')).resolves.toBeUndefined();
    expect((fetch.mock.calls[0]![1] as RequestInit).method).toBe('DELETE');
  });

  it('POST /v1/webhooks/:id/rotate-secret reveals the new secret once', async () => {
    const fetch = vi.fn(async () =>
      ok({
        id: 'wh_1',
        url: 'https://example/wh',
        events: ['payment.received'],
        agentId: null,
        signingSecret: 'whsk_ROTATED',
        active: true,
      })
    );
    const client = build(fetch);
    const wh = await client.webhooks.rotateSecret('wh_1');
    expect(wh.signingSecret).toBe('whsk_ROTATED');
    expect(fetch.mock.calls[0]![0]).toBe('https://api.test/v1/webhooks/wh_1/rotate-secret');
  });

  it('POST /v1/webhooks/:id/test - returns the queued delivery row', async () => {
    const fetch = vi.fn(async () =>
      ok(
        {
          id: 'whd_1',
          eventType: 'webhook.test',
          status: 'queued',
          attemptCount: 0,
          network: 'testnet',
        },
        202
      )
    );
    const client = build(fetch);
    const d = await client.webhooks.test('wh_1', {
      eventType: 'payment.received',
      payload: { amount: '12.5' },
    });
    expect(d.status).toBe('queued');
    expect(d.eventType).toBe('webhook.test');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.test/v1/webhooks/wh_1/test');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).body).toBe(
      '{"eventType":"payment.received","payload":{"amount":"12.5"}}'
    );
  });
});

describe('createClient.payments', () => {
  function paymentResponse() {
    return ok({
      id: 'pay_1',
      agentId: 'agt_1',
      to: '0xrecipient',
      amountWei: '12500000',
      status: 'pending',
      network: 'testnet',
    });
  }

  it('POST /v1/payments forwards the body verbatim', async () => {
    const fetch = vi.fn(async () => paymentResponse());
    const client = build(fetch);
    await client.payments.create({
      agentId: 'agt_1',
      to: '0xrecipient',
      amountWei: '12500000',
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.test/v1/payments');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      agentId: 'agt_1',
      to: '0xrecipient',
      amountWei: '12500000',
    });
  });

  it('auto-mints Idempotency-Key when the caller omits one', async () => {
    const fetch = vi.fn(async () => paymentResponse());
    const client = build(fetch);
    await client.payments.create({ agentId: 'agt_1', to: '0xx', amountWei: '1' });
    const headers = (fetch.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    const key = headers['Idempotency-Key'];
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(16);
  });

  it('uses the caller-supplied Idempotency-Key verbatim', async () => {
    const fetch = vi.fn(async () => paymentResponse());
    const client = build(fetch);
    await client.payments.create(
      { agentId: 'agt_1', to: '0xx', amountWei: '1' },
      { idempotencyKey: 'my-stable-key-001' }
    );
    const headers = (fetch.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('my-stable-key-001');
  });

  it('does NOT retry on 5xx by default (no double-spend)', async () => {
    const fetch = vi.fn(async () =>
      ok({ error: { code: 'internal.unhandled', message: 'boom' } }, 500)
    );
    const client = build(fetch);
    await expect(
      client.payments.create({ agentId: 'agt_1', to: '0xx', amountWei: '1' })
    ).rejects.toMatchObject({ status: 500 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('opting in via retry: "default" re-uses the same Idempotency-Key across retries', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(ok({ error: { code: 'internal.unhandled', message: 'x' } }, 500))
      .mockResolvedValueOnce(paymentResponse());
    const client = build(fetch);
    await client.payments.create(
      { agentId: 'agt_1', to: '0xx', amountWei: '1' },
      { retry: 'default' }
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    const firstHeaders = (fetch.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    const secondHeaders = (fetch.mock.calls[1]![1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(secondHeaders['Idempotency-Key']).toBe(firstHeaders['Idempotency-Key']);
  });

  it('surfaces ApiKeyError when the server returns apikey.scope_insufficient', async () => {
    const fetch = vi.fn(async () =>
      ok({ error: { code: 'apikey.scope_insufficient', message: 'need pay_bills' } }, 403)
    );
    const client = build(fetch);
    await expect(
      client.payments.create({ agentId: 'agt_1', to: '0xx', amountWei: '1' })
    ).rejects.toBeInstanceOf(ApiKeyError);
  });
});

describe('createClient (boot)', () => {
  it('rejects an empty apiKey at construction time', () => {
    expect(() => createClient({ apiKey: '' })).toThrow(/apiKey is required/);
  });

  // B-4 lands the real payments resource; the "not wired" stub is gone.

  it('non-apikey error codes surface as Blockchain0xError (not the narrower ApiKeyError)', async () => {
    const fetch = vi.fn(async () =>
      ok({ error: { code: 'request.invalid', message: 'bad' } }, 400)
    );
    const client = build(fetch);
    try {
      await client.agents.get('agt_x');
    } catch (e) {
      expect(e).toBeInstanceOf(Blockchain0xError);
      expect(e).not.toBeInstanceOf(ApiKeyError);
    }
  });
});
