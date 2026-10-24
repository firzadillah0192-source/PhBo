# Generation webhook — proposed implementation, 2026-10-18

Status: DEPLOYED — PASS. Owner approved this design and implementation. See GENERATION_WEBHOOK_HANDOFF.md for tests, frozen candidate and separately gated production activation. Owner subsequently approved production activation; SQL027 applied after verified backup and release181825Z deployed. See handoff for evidence.

## Proposed scope

One HTTPS webhook endpoint per integration API key, managed by the owning signed-in account in Account → API & Integrasi. Events: generation.completed and generation.failed for new jobs originally attributed to that key. No old-job backfill. Same-account idempotent retry via a different key keeps the original attribution and creates no extra event/charge. Existing Standard/Fast rules, billing, storage and retention remain unchanged.

Use the existing API and Express worker, with a bounded independent dispatch loop in migration-worker.ts. HTTP delivery must not run inside generation database transactions or block the generation processing loop. No new service/container, Redis queue or provider.

## Required additive schema (not yet written or approved)

Proposed backend/migrations/027_generation_webhooks.sql, subject to filename conflict check:

- integration_webhook_endpoints: id, account_id, key_id (unique), URL, enabled, selected events, encrypted signing secret with encryption key version, timestamps. Foreign keys preserve account/key ownership. Configuration changes increment version.
- integration_webhook_deliveries: immutable event ID, endpoint/config version, account/key/job references, event type, immutable versioned payload, target URL snapshot, PENDING/IN_FLIGHT/DELIVERED/EXHAUSTED/CANCELLED, attempt count, next attempt, lease token/expiry, timestamps. Unique(job_id,event_type,endpoint_id) prevents duplicate automatic notifications. Due-work index supports dispatcher. Target URL remains fixed for an event; changes affect future events, with explicit owner redelivery creating a separately audited attempt against a reviewed current endpoint.
- integration_webhook_attempts: delivery ID, attempt number, timestamp, duration, HTTP status and bounded safe error category. No arbitrary response body, secret or raw customer data. Unique(delivery_id,attempt_number).

Use transactional outbox inserts in all terminal paths in CustomerGenerationModel: complete, fail, queue failure, retry exhaustion. Respect existing lease/state guards and finalize billing before composing the event. API and worker must both carry the implementation. Transaction rollback removes both state transition and event. Missing/disabled endpoint means no event. Database insert failure rolls back terminal transition so existing recovery retries it; never repeat a completed AI provider call merely to deliver HTTP.

Dedicated WEBHOOK_SECRET_ENCRYPTION_KEY configured privately by owner, never pasted into chat. Encrypt random signing secrets using authenticated encryption, show plaintext only on create/rotation; do not reuse API-key hashes or store plaintext. Versioned key configuration required to retain decryption of outstanding deliveries. Rotation cancels outstanding old-secret deliveries with explicit UI notice; new events use the new secret. Key revocation cancels unsent deliveries; history remains visible. Recheck endpoint/key/account status immediately before send. Disable/revoke racing an already in-flight HTTP request cannot recall that request; UI/docs must say so.

## Delivery contract

JSON envelope: id, type, created_at, api_version and data {job_id,key_id,state,template_id,result_id,error_code,credit_charge}. No provider/model/prompt, photo bytes, internal storage path, API secret or public QR/claim token. Result ID is present only for a completed paid result; receiver uses existing authenticated Generation/Storage API to fetch the current downloadable result, respecting expiry/deletion.

Headers: X-NXBooth-Event-Id, X-NXBooth-Timestamp, X-NXBooth-Signature (v1=hex HMAC-SHA256 of timestamp + '.' + exact raw JSON bytes). Use constant-time verification, e.g. five-minute timestamp tolerance and persistent event-ID deduplication at receiver. Same event ID/payload across automatic retries, fresh timestamp/signature per attempt. At-least-once delivery; never promise exactly once.

Only HTTP 2xx is acknowledged. Timeout/non-2xx fails attempt. No redirect following. Five total attempts: immediately, after 1 minute, 5 minutes, 30 minutes, 2 hours (delays measured from previous attempt); bounded concurrency and ten-second timeout. Use PostgreSQL SKIP LOCKED and expiring lease token to claim due events safely; stale workers cannot acknowledge a newer lease. Crash after remote receipt may deliver a duplicate. Manual retry is owner-only, rate limited, preserves event ID, records another attempt and cannot bypass revoked/disabled configuration. No retry changes job state or wallet.

Security: reject non-HTTPS URLs, credentials, non-443 ports, fragments and excessive length. Resolve all addresses on every attempt, reject local/private/link-local/multicast/reserved IPv4/IPv6 (including IPv4-mapped), and pin the connection to a validated address while verifying TLS hostname. No environment proxy or redirect fallback. Bound response reads and never persist bodies. Unit/integration checks must cover DNS rebinding, redirect to internal services, timeout and address-family bypass. Internal service/MinIO URLs must never be accepted.

## Account API and frontend (proposed)

Cookie-only ownership routes under /api/account/api-keys/:id/webhook:
- GET configuration (secret omitted), PUT URL/events/enabled, POST rotate-secret.
- GET deliveries with cursor/state filter and GET deliveries/:deliveryId/attempts.
- POST deliveries/:deliveryId/retry with owner checks, idempotency/concurrency limits.

Use existing private/no-store and management rate limiter, strict Zod validation, structured error codes. Other-account and unknown resources404; Bearer-only auth401. Separate permission to retry from generation consent: webhook retry costs zero credit and never creates a generation. Secret input/display masked; frontend clears revealed secret on dismissal/navigation, never localStorage or analytics.

Frontend: configuration, status, event selectors, one-time secret reveal/rotation, delivery status + attempts and explicit retry, loading/empty/error states. Reuse account style/i18n and key refresh. Document verification and retry/deduplication examples in API Explorer, frontend/src/api.js and docs/API_CONTRACT.md in the same implementation.

Delivery/attempt log retention proposed30 days; immutable terminal event snapshots may contain result IDs only, never retain photo content beyond existing rules. Cleanup batches must not remove active/leased deliveries. Confirm this operational retention in approval.

## Review options

A (recommended): approve three additive tables, dedicated encrypted signing-secret config, existing-worker dispatcher and30-day delivery logs. Enables restart-safe retries/history without a new service.
B: keep current polling/status API and defer webhooks. No schema or new secret config, but no automatic delivery.

## Validation and production boundary

After approval: implement and test exact-once outbox creation across terminal paths, charge/refund consistency, cross-key idempotency, foreign-owner denial, signatures/rotation, at-least-once delivery, concurrent leases, crash recovery, endpoint status changes, SSRF protections and retention on disposable DB/HTTP fixtures. Backend typecheck/test/build, frontend test/build and real browser account flows at1440/390/320. Use mocked terminal metadata, never claim fixture images are actual AI output.

Prepare reviewable additive SQL and isolated release candidate. Production application remains a separate explicit approval after reviewed backup, as required by AGENTS.md. Deployment also requires fresh owner approval. Existing live API/web/helper stay unchanged during implementation. Preserve dirty Lab/footer/desktop files and latest peer customer-ui-20261018T165410Z release.


Implementation clarifications: signing-secret generation is the endpoint version; ordinary URL edits preserve queued target snapshots. Manual redelivery requires the original target URL and active signing-secret version and does not redirect an old event to a different URL. Query strings are also forbidden in destination URLs. Dispatcher is concurrency1. Private runtime.env supplies the dedicated keyring to snapshots so existing deployment tools can preserve it without new secret CLI arguments. No main .env edits.
