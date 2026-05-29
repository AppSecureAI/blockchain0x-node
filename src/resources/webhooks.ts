/**
 * webhooks resource (sub-plan 21.1 row B-3).
 *
 * Mirrors `/v1/webhooks` CRUD + `rotate-secret` + `test`. Per the §4.5
 * matrix every method is `mode: 'block'` for API-key callers (the
 * `/v1/webhooks*` prefix is hard-blocked), so the SDK surface here is
 * what a future workspace-scope key OR a cookie-auth dashboard call
 * routed through the SDK would use. Agent-scoped keys calling these
 * methods will receive `apikey.unsupported_endpoint` from the server.
 */

import type { HttpTransport } from '../http.js';

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: readonly string[];
  /** Null = workspace-wide; set = scoped to this agent. */
  agentId: string | null;
  /** Returned on create + rotate-secret; null on subsequent reads. */
  signingSecret: string | null;
  active: boolean;
  createdAt?: string;
  [extra: string]: unknown;
}

export interface WebhookEndpointPage {
  data: readonly WebhookEndpoint[];
  page: { next: string | null; prev: string | null };
}

export interface WebhookEndpointCreate {
  url: string;
  events: readonly string[];
  description?: string;
  /** Agent-scoped variant (sub-plan 16.5.B13). */
  agentId?: string;
}

export interface WebhookEndpointUpdate {
  url?: string;
  events?: readonly string[];
  active?: boolean;
}

export interface WebhookDelivery {
  id: string;
  eventType: string;
  status: string;
  attemptCount: number;
  network: 'mainnet' | 'testnet';
  createdAt?: string;
  deliveredAt?: string | null;
  lastResponseStatus?: number | null;
  lastError?: string | null;
  [extra: string]: unknown;
}

export interface WebhooksResource {
  list(args?: { cursor?: string; limit?: number; agentId?: string }): Promise<WebhookEndpointPage>;
  create(body: WebhookEndpointCreate): Promise<WebhookEndpoint>;
  update(webhookId: string, patch: WebhookEndpointUpdate): Promise<WebhookEndpoint>;
  delete(webhookId: string): Promise<void>;
  /**
   * POST /v1/webhooks/{id}/rotate-secret. Returns the same shape as
   * create with `signingSecret` populated; show it to the operator
   * exactly once.
   */
  rotateSecret(webhookId: string): Promise<WebhookEndpoint>;
  /**
   * POST /v1/webhooks/{id}/test. Pre-inserts a `queued` delivery row +
   * enqueues a real `webhook.test` notification job (A-8). Returns the
   * delivery row immediately (202); use `webhooks.deliveries` reads
   * (not yet shipped) to poll for the final `delivered` / `failed`
   * status, or rely on the operator's receiver to confirm.
   */
  test(
    webhookId: string,
    body: { eventType: string; payload?: Record<string, unknown> }
  ): Promise<WebhookDelivery>;
}

export function createWebhooksResource(http: HttpTransport): WebhooksResource {
  return {
    list(args) {
      return http.request<WebhookEndpointPage>({
        method: 'GET',
        path: '/v1/webhooks',
        query: { cursor: args?.cursor, limit: args?.limit, agentId: args?.agentId },
      });
    },
    create(body) {
      return http.request<WebhookEndpoint>({
        method: 'POST',
        path: '/v1/webhooks',
        body,
      });
    },
    update(webhookId, patch) {
      return http.request<WebhookEndpoint>({
        method: 'PATCH',
        path: `/v1/webhooks/${encodeURIComponent(webhookId)}`,
        body: patch,
      });
    },
    delete(webhookId) {
      return http.request<void>({
        method: 'DELETE',
        path: `/v1/webhooks/${encodeURIComponent(webhookId)}`,
      });
    },
    rotateSecret(webhookId) {
      return http.request<WebhookEndpoint>({
        method: 'POST',
        path: `/v1/webhooks/${encodeURIComponent(webhookId)}/rotate-secret`,
      });
    },
    test(webhookId, body) {
      return http.request<WebhookDelivery>({
        method: 'POST',
        path: `/v1/webhooks/${encodeURIComponent(webhookId)}/test`,
        body,
      });
    },
  };
}
