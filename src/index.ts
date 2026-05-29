/**
 * `@blockchain0x/node` - the official Blockchain0x Node.js SDK.
 *
 * Sub-plan 21.1 row B-1 scaffold. The B-2..B-6 rows fill in:
 *   - `createClient({ apiKey, baseUrl?, network? })` with retry on 5xx/429.
 *   - `agents`, `apiKeys`, `webhooks`, `payments` resource namespaces.
 *   - `Blockchain0x.webhooks.verify(...)` HMAC verifier.
 *
 * Public surface:
 *
 *   import { createClient, webhooks, Blockchain0xError } from '@blockchain0x/node';
 *
 *   const client = createClient({ apiKey: process.env.B0X_API_KEY! });
 *   const agent = await client.agents.get('agt_01HQX5');
 *
 *   const ok = webhooks.verify({
 *     headers: req.headers,
 *     rawBody: req.rawBody,
 *     secret: process.env.B0X_WEBHOOK_SECRET!,
 *   });
 *
 * Crypto rule: nothing in this SDK ever logs or echoes a plaintext secret.
 * The HMAC verifier compares in constant time and surfaces only the
 * coarse `ok` / error-code pair.
 */

export { createClient } from './client.js';
export type { Blockchain0xClient, CreateClientOptions } from './client.js';

export { Blockchain0xError, ApiKeyError, WebhookSignatureError } from './errors.js';
export type { Blockchain0xErrorBody } from './errors.js';

// `webhooks.verify` is exported BOTH as a top-level namespace and via
// the `./webhooks` subpath so customers can pick whichever import shape
// suits their bundler. Both forms resolve to the same implementation.
import * as webhooks from './webhooks/index.js';
export { webhooks };
