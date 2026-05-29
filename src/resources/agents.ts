/**
 * Agents resource (sub-plan 21.1 row B-2).
 *
 * The §4.5 matrix says an agent-scoped key can only GET its own agent
 * (`apikey.agent_mismatch` on any other id). The SDK doesn't try to
 * enforce that client-side - the server does, and the SDK surfaces the
 * resulting error class so the caller can branch on it cleanly.
 */

import type { HttpTransport } from '../http.js';

export interface AgentSummary {
  id: string;
  name: string | null;
  network: 'mainnet' | 'testnet';
  disabled: boolean;
  /** Other fields exist on the wire; we keep this union open so a
   *  server-side addition doesn't force an SDK bump. */
  [extra: string]: unknown;
}

export interface AgentListPage {
  data: readonly AgentSummary[];
  page: { next: string | null; prev: string | null };
}

export interface AgentsResource {
  get(id: string): Promise<AgentSummary>;
  list(args?: { cursor?: string; limit?: number }): Promise<AgentListPage>;
  /**
   * Workspace-scope keys may call this once they exist (the §4.5 matrix
   * blocks agent-scoped keys). The SDK forwards the body verbatim.
   */
  create(body: Record<string, unknown>): Promise<AgentSummary>;
}

export function createAgentsResource(http: HttpTransport): AgentsResource {
  return {
    get(id) {
      return http.request<AgentSummary>({
        method: 'GET',
        path: `/v1/agents/${encodeURIComponent(id)}`,
      });
    },
    list(args) {
      return http.request<AgentListPage>({
        method: 'GET',
        path: '/v1/agents',
        query: { cursor: args?.cursor, limit: args?.limit },
      });
    },
    create(body) {
      return http.request<AgentSummary>({ method: 'POST', path: '/v1/agents', body });
    },
  };
}
