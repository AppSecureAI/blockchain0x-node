/**
 * `createClient({ apiKey, baseUrl?, network? })`.
 *
 * Sub-plan 21.1 rows B-1 (scaffold) + B-2 (real wire path for agents +
 * apiKeys + structured errors + retry on 5xx/429). Rows B-3 / B-4 fill
 * in the `webhooks` and `payments` resources against the same transport.
 */

import { createHttpTransport, type HttpConfig, type HttpTransport } from './http.js';
import { createAgentsResource, type AgentsResource } from './resources/agents.js';
import { createApiKeysResource, type ApiKeysResource } from './resources/api-keys.js';
import { createWebhooksResource, type WebhooksResource } from './resources/webhooks.js';
import { createPaymentsResource, type PaymentsResource } from './resources/payments.js';

export interface CreateClientOptions {
  apiKey: string;
  baseUrl?: string;
  network?: 'mainnet' | 'testnet';
  timeoutMs?: number;
  /**
   * Internal testing seam - lets the unit suite pass a fake fetch +
   * deterministic sleep/random without monkey-patching globals.
   * Customers MUST NOT rely on these fields; they may change between
   * patch releases.
   */
  _transport?: Pick<HttpConfig, 'fetch' | 'rand' | 'sleep'>;
}

export interface Blockchain0xClient {
  readonly options: Readonly<
    Required<Pick<CreateClientOptions, 'apiKey' | 'baseUrl' | 'timeoutMs'>>
  > &
    Pick<CreateClientOptions, 'network'>;
  readonly agents: AgentsResource;
  readonly apiKeys: ApiKeysResource;
  readonly webhooks: WebhooksResource;
  readonly payments: PaymentsResource;
}

const DEFAULT_BASE_URL = 'https://api.blockchain0x.com';
const DEFAULT_TIMEOUT_MS = 30_000;

export function createClient(options: CreateClientOptions): Blockchain0xClient {
  if (!options.apiKey || options.apiKey.length === 0) {
    throw new Error('createClient: apiKey is required');
  }
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const network = options.network;

  const http: HttpTransport = createHttpTransport({
    apiKey: options.apiKey,
    baseUrl,
    network,
    timeoutMs,
    ...(options._transport?.fetch ? { fetch: options._transport.fetch } : {}),
    ...(options._transport?.rand ? { rand: options._transport.rand } : {}),
    ...(options._transport?.sleep ? { sleep: options._transport.sleep } : {}),
  });

  return {
    options: {
      apiKey: options.apiKey,
      baseUrl,
      timeoutMs,
      ...(network ? { network } : {}),
    },
    agents: createAgentsResource(http),
    apiKeys: createApiKeysResource(http),
    webhooks: createWebhooksResource(http),
    payments: createPaymentsResource(http),
  };
}
