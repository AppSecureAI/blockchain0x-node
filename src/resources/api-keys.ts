/**
 * apiKeys resource (sub-plan 21.1 row B-2).
 *
 * Every method here is `mode: 'block'` per the §4.5 matrix when called
 * via an API key (`/v1/api-keys/*` is hard-blocked, with `/v1/api-keys/usage`
 * carved out as the single exception - exposed below as `usage`). The
 * surface exists so a future workspace-scope key (or a cookie-auth
 * dashboard call routed through the SDK) can manage keys; an agent-scoped
 * key calling these will get `apikey.unsupported_endpoint` from the
 * server.
 */

import type { HttpTransport } from '../http.js';

/**
 * Sub-plan 21.2 §3.1: the closed set of wire-level scopes the dashboard
 * offers at create-time. The names mirror the dashboard's human-readable
 * checkboxes:
 *
 *   read_wallet_metadata   - see balances, txns, history, limits
 *   manage_wallet_metadata - + update profile copy (tagline, social, about)
 *   pay_bills              - outbound payments, capped by spend allowance
 *   receive_money          - create invoices + settle them with on-chain proof
 *
 * Identity (name, slug, visibility, disabled) and infrastructure (API key
 * CRUD, webhook CRUD, spend permission writes) are dashboard-only forever.
 */
export type ApiKeyScope =
  | 'read_wallet_metadata'
  | 'manage_wallet_metadata'
  | 'pay_bills'
  | 'receive_money';

export interface ApiKey {
  id: string;
  prefix: string;
  label: string | null;
  scopes: readonly ApiKeyScope[];
  agentId: string | null;
  createdAt?: string;
  rotatedAt?: string | null;
  revokedAt?: string | null;
  [extra: string]: unknown;
}

export interface ApiKeyWithSecret extends ApiKey {
  secret: string;
}

export interface ApiKeyRotation {
  predecessor: ApiKey;
  successor: ApiKeyWithSecret;
  overlapEndsAt: string;
}

export interface ApiKeyListPage {
  data: readonly ApiKey[];
  page: { next: string | null; prev: string | null };
}

export interface ApiKeyCreateBody {
  label: string;
  scopes: readonly ApiKeyScope[];
  agentId?: string;
}

export interface ApiKeyUsageSeriesPoint {
  d: string; // ISO date YYYY-MM-DD
  calls: number;
  errors: number;
}

export interface ApiKeyUsage {
  windowDays: number;
  granularity: 'day';
  series: readonly ApiKeyUsageSeriesPoint[];
  totals: { calls: number; errors: number };
  scope: {
    workspaceId: string;
    agentId: string | null;
    apiKeyId: string | null;
  };
}

export interface ApiKeysResource {
  list(args?: { cursor?: string; limit?: number }): Promise<ApiKeyListPage>;
  create(body: ApiKeyCreateBody): Promise<ApiKeyWithSecret>;
  rotate(apiKeyId: string): Promise<ApiKeyRotation>;
  revoke(apiKeyId: string): Promise<void>;
  /**
   * GET /v1/api-keys/usage. Exempted from the hard-block; an
   * agent-scoped key can read its OWN agent's rollup with `read_wallet_metadata`
   * (AK-30..32). Passing a disagreeing `agentId` returns
   * `apikey.agent_mismatch`.
   */
  usage(args?: {
    windowDays?: number;
    agentId?: string;
    apiKeyId?: string;
    mode?: 'test' | 'live';
  }): Promise<ApiKeyUsage>;
}

export function createApiKeysResource(http: HttpTransport): ApiKeysResource {
  return {
    list(args) {
      return http.request<ApiKeyListPage>({
        method: 'GET',
        path: '/v1/api-keys',
        query: { cursor: args?.cursor, limit: args?.limit },
      });
    },
    create(body) {
      return http.request<ApiKeyWithSecret>({
        method: 'POST',
        path: '/v1/api-keys',
        body,
      });
    },
    rotate(apiKeyId) {
      return http.request<ApiKeyRotation>({
        method: 'POST',
        path: `/v1/api-keys/${encodeURIComponent(apiKeyId)}/rotate`,
      });
    },
    revoke(apiKeyId) {
      return http.request<void>({
        method: 'DELETE',
        path: `/v1/api-keys/${encodeURIComponent(apiKeyId)}`,
      });
    },
    usage(args) {
      return http.request<ApiKeyUsage>({
        method: 'GET',
        path: '/v1/api-keys/usage',
        query: {
          windowDays: args?.windowDays,
          agentId: args?.agentId,
          apiKeyId: args?.apiKeyId,
          mode: args?.mode,
        },
      });
    },
  };
}
