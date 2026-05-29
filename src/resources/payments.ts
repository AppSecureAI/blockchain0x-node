/**
 * payments resource (sub-plan 21.1 row B-4).
 *
 * `POST /v1/payments` is the agent's outbound-spend path. Two safety
 * differences from every other SDK call:
 *
 *   1. **Auto `Idempotency-Key`.** The server's idempotency plugin
 *      collapses retries-with-the-same-key into a single chain
 *      submission (sub-plan 15.6 row 39). When the caller does not
 *      supply one, the SDK mints a ULID-shaped value so a fetch retry
 *      driven by the user's framework never accidentally double-spends.
 *   2. **Retry OFF by default.** Per the plan §5.2: even though 5xx
 *      retries are safe for read endpoints, a payment retry without a
 *      matching idempotency key on the server (e.g. response lost on
 *      the wire) could double-submit. We pass `retry: 'off'` and let
 *      the operator opt in deliberately via `opts.retry = 'default'`.
 *
 * The idempotency header sticks at the FIRST mint, even if the caller
 * passes `retry: 'default'` - that way the server can still collapse
 * a same-key retry.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import type { HttpTransport } from '../http.js';

export interface PaymentCreate {
  agentId: string;
  to: string;
  amountWei: string;
  token?: string;
  metadata?: Record<string, unknown>;
}

export interface Payment {
  id: string;
  agentId: string;
  to: string | null;
  amountWei: string;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  txHash?: string | null;
  network: 'mainnet' | 'testnet';
  createdAt?: string;
  completedAt?: string | null;
  metadata?: Record<string, unknown>;
  [extra: string]: unknown;
}

export interface PaymentCreateOptions {
  /** Caller-supplied idempotency key. When omitted the SDK mints one. */
  idempotencyKey?: string;
  /**
   * Per-call retry override. Defaults to `'off'` so a flaky network
   * does NOT re-submit a payment without an explicit decision. When
   * set to `'default'` the same SDK retry policy used elsewhere (5xx
   * + 429) applies, and the auto-minted `Idempotency-Key` lets the
   * server collapse the retry to a single chain submission.
   */
  retry?: 'off' | 'default';
}

export interface PaymentsResource {
  create(body: PaymentCreate, opts?: PaymentCreateOptions): Promise<Payment>;
}

/**
 * Mint a ULID-shaped 26-char Crockford-base32 identifier. Stable across
 * Node versions; not cryptographically scoped (the value just needs to
 * be unique enough that two unrelated retries don't collide).
 */
function mintIdempotencyKey(): string {
  // Node >=18 has crypto.randomUUID; the ULID shape is preferable for
  // log correlation but a UUID works equally well for the
  // idempotency-plugin keyspace. We use a hex-shaped form: 32 hex chars.
  if (typeof randomUUID === 'function') {
    return randomUUID().replace(/-/g, '');
  }
  return randomBytes(16).toString('hex');
}

export function createPaymentsResource(http: HttpTransport): PaymentsResource {
  return {
    create(body, opts) {
      const idempotencyKey = opts?.idempotencyKey ?? mintIdempotencyKey();
      return http.request<Payment>({
        method: 'POST',
        path: '/v1/payments',
        body,
        headers: { 'Idempotency-Key': idempotencyKey },
        retry: opts?.retry ?? 'off',
      });
    },
  };
}
