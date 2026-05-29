# Changelog

All notable changes to `@blockchain0x/node` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-alpha.1] - 2026-05-29

First release published via GitHub Actions + npm Trusted Publisher OIDC
(provenance attestation). Functionally identical to `0.1.0-alpha.0`; this
version validates the CI publish wire and ships the LICENSE + CHANGELOG
files alongside the tarball.

### Added

- `LICENSE` file (Apache-2.0) now ships in the tarball.
- `CHANGELOG.md` file shipping in the tarball.

## [0.1.0-alpha.0] - 2026-05-29

Initial alpha publish. Manual release via the committed
`scripts/publish.sh` helper.

### Added

- `createClient({ apiKey, baseUrl?, network?, timeoutMs? })` - the public
  entry point.
- `client.agents.get(id) / list() / create()` resource.
- `client.apiKeys.list() / create() / rotate(id) / revoke(id) / usage({ windowDays })`
  resource.
- `client.webhooks.list() / create() / update(id, patch) / delete(id) /
rotateSecret(id) / test(id, body)` resource.
- `client.payments.create(body, opts?)` with auto-minted `Idempotency-Key`
  and opt-in retry (`retry: 'default'`).
- `webhooks.verify({ headers, rawBody, secret, toleranceSec?, now? })` -
  HMAC-SHA256 verifier with constant-time comparison and a 5-minute replay
  window (matches the worker's signing scheme byte-for-byte).
- Discriminated-union error classes: `Blockchain0xError`, `ApiKeyError`,
  `WebhookSignatureError` with stable code strings (`apikey.scope_insufficient`,
  `apikey.agent_mismatch`, `signature_mismatch`, etc.).
- Auto-retry on `429` (honouring `Retry-After`) + `5xx` with exponential
  backoff (250ms / 500ms / 1s, capped at 8s, 3 retries, 50% jitter).
  `POST /v1/payments` is retry-off by default.

[0.1.0-alpha.1]: https://github.com/Tosh-Labs/blockchain0x-node/releases/tag/v0.1.0-alpha.1
[0.1.0-alpha.0]: https://github.com/Tosh-Labs/blockchain0x-node/releases/tag/v0.1.0-alpha.0
