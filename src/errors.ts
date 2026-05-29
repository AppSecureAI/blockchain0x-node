/**
 * Structured error classes the SDK throws for failed responses.
 *
 * Sub-plan 21.1 row B-1 scaffold. Mirrors the backend's
 * `error-envelope` shape so SDK consumers can switch on the same
 * `code` slug they would see in the wire response.
 *
 * Customers do `instanceof Blockchain0xError` for the generic catch and
 * `instanceof WebhookSignatureError` / `instanceof ApiKeyError` for the
 * narrowed ones. Row B-2 wires the client to throw the appropriate
 * variant based on the response envelope; B-5 throws WebhookSignatureError
 * from `webhooks.verify(...)`.
 */

export interface Blockchain0xErrorBody {
  code: string;
  message: string;
  requestId?: string;
  details?: unknown;
}

export class Blockchain0xError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | undefined;
  readonly details: unknown;

  constructor(args: {
    code: string;
    message: string;
    status: number;
    requestId?: string;
    details?: unknown;
  }) {
    super(args.message);
    this.name = 'Blockchain0xError';
    this.code = args.code;
    this.status = args.status;
    this.requestId = args.requestId;
    this.details = args.details;
  }
}

export class ApiKeyError extends Blockchain0xError {
  constructor(args: {
    code: string;
    message: string;
    status: number;
    requestId?: string;
    details?: unknown;
  }) {
    super(args);
    this.name = 'ApiKeyError';
  }
}

export class WebhookSignatureError extends Error {
  /**
   * One of the verifier's known failure codes. Stable: customers
   * branch on this in their HTTP handler.
   */
  readonly code:
    | 'signature_missing'
    | 'signature_malformed'
    | 'timestamp_missing'
    | 'timestamp_outside_window'
    | 'signature_mismatch';

  constructor(code: WebhookSignatureError['code'], message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
    this.code = code;
  }
}
