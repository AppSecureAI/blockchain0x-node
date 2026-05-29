/**
 * paymentRequests resource (sub-plan 21.2 row A-3 / B-3).
 *
 * Exposes the settle path the x402 server adapter calls after verifying
 * an `X-Payment` header. The request body carries the on-chain proof
 * tuple (txHash + payerAddress + amountUsdcVerified); the backend
 * re-verifies it against the canonical `transactions` table before
 * flipping the invoice to `settled`. Trust model: the SDK is a thin
 * wrapper, the server is the trust anchor.
 *
 * No `idempotency-key` mint here - settle is naturally idempotent
 * server-side (an invoice already in `settled` state returns 409
 * `payment_request.not_settleable`, never a duplicate event).
 */

import type { HttpTransport } from '../http.js';

export interface PaymentRequestSettleBody {
  /** Hash of the on-chain transfer that paid the invoice (0x + 64 hex). */
  txHash: string;
  /** Address that sent the funds (0x + 40 hex). */
  payerAddress: string;
  /** Human USDC decimal the payer claims they sent (e.g. `"0.10"`). */
  amountUsdcVerified: string;
}

export interface PaymentRequestSettled {
  id: string;
  status: 'settled';
  settledTxHash: string;
  settledAt: string;
}

export interface PaymentRequestsResource {
  settle(args: {
    paymentRequestId: string;
    body: PaymentRequestSettleBody;
  }): Promise<PaymentRequestSettled>;
}

export function createPaymentRequestsResource(http: HttpTransport): PaymentRequestsResource {
  return {
    settle({ paymentRequestId, body }) {
      return http.request<PaymentRequestSettled>({
        method: 'POST',
        path: `/v1/payment-requests/${encodeURIComponent(paymentRequestId)}/settle`,
        body,
      });
    },
  };
}
