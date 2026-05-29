/**
 * transactions resource (sub-plan 21.2 row B-3).
 *
 * Read-only handle on the `transactions` table - the x402 client polls
 * `transactions.get` to find out when a freshly broadcast `payments.create`
 * has confirmed on-chain (status flips to `confirmed`). Scope:
 * `read_wallet_metadata`.
 */

import type { HttpTransport } from '../http.js';

export interface Transaction {
  id: string;
  agentId: string;
  direction: 'inbound' | 'outbound';
  status: 'pending' | 'submitted' | 'confirmed' | 'failed';
  txHash?: string | null;
  userOpHash?: string | null;
  fromAddress?: string | null;
  toAddress?: string | null;
  amountWei: string;
  token?: string;
  network: 'mainnet' | 'testnet';
  createdAt?: string;
  confirmedAt?: string | null;
  [extra: string]: unknown;
}

export interface TransactionsResource {
  get(transactionId: string): Promise<Transaction>;
}

export function createTransactionsResource(http: HttpTransport): TransactionsResource {
  return {
    get(transactionId) {
      return http.request<Transaction>({
        method: 'GET',
        path: `/v1/transactions/${encodeURIComponent(transactionId)}`,
      });
    },
  };
}
