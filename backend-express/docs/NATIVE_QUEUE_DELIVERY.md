# Native PostgreSQL dispatch and private MinIO delivery

These additions run inside the existing Express API and TypeScript worker.
They do not introduce another application API, Result table or credit system.
PostgreSQL dispatch and direct signed delivery are active in production. See
`NATIVE_KIOSK_RELEASE.md` for migration, release validation and rollback records.

## PostgreSQL dispatch

`GENERATION_QUEUE_BACKEND=postgres` selects PostgreSQL for customer and Admin
preview dispatch. Production currently selects `postgres`; the default remains
`redis`. Migration
`backend/migrations/018_postgres_generation_dispatch.sql` adds a small dispatch
table with separate customer/preview namespaces and deduplicated job IDs.

Consumers use one atomic `DELETE ... RETURNING` with `FOR UPDATE SKIP LOCKED`.
No queue lock is held during provider or image processing. Existing generation
jobs and worker leases remain authoritative: recovery redispatches queued jobs
and work whose lease expired. A dequeue is not a completed generation. Credit
reservation, success and refund still occur through the existing job lifecycle.

Redis remains necessary for API rate limits. Selecting PostgreSQL dispatch does
not authorize deleting Redis or changing its production network configuration.

The production switch applied migration 018 and coordinated API and worker
configuration after draining active work. Health checks verify both queue
namespaces. The source app's separate Prisma migrations must not be applied to
the current production database.

## Signed MinIO URLs

`MINIO_SIGNED_URLS_ENABLED=false` is the default. Production explicitly enables
signed delivery. Storage must be
MinIO and `MINIO_PUBLIC_ENDPOINT`, port and SSL must identify an actual
browser-reachable HTTPS S3 endpoint. The endpoint is supplied to the signer
before signing; signed URLs are never rewritten to a different hostname.
The operator configured `storage.gennexbyte.com` to the existing MinIO S3 API
through Cloudflare; the endpoint responds over public HTTPS and bypasses cache.

Only owned upload and Result objects can be signed. Catalog objects are
rejected. URLs expire after the configured TTL (default 300 seconds), bounded
by upload retention and Kiosk session expiry. Signing errors do not expose
SDK errors or credentials. A signed URL is a short-lived bearer capability:
it remains usable until expiry even if the browser session is revoked.

Native Kiosk uses `/api/v1/photos/:id/url` and `/api/v1/results/:id/url` after
the existing session and ownership checks. The response identifies `minio` or
`api` delivery and carries an expiry for direct delivery. Images refresh before
expiry; resolver errors and failed image loads fall back to authorized API
image routes. Signed URLs stay in memory, never browser storage. Existing
download and public `/r/:claimToken` routes continue using the shared API,
preserving ResultClaim revocation behavior.

## Validation

Unit tests cover queue contracts, closing idle consumers, explicit configuration,
ownership, signing scope, TTL and hostname checks. Disposable PostgreSQL tests
apply migration 018 twice, exercise concurrent dequeue and dispatch deduplication,
and verify expired-lease recovery and one winning worker claim.

Real MinIO validation uses a random synthetic test bucket: signed image bytes,
private/no-store response, tampered-signature rejection and deletion are checked,
then the test bucket is removed. It does not access customer images.
Frontend tests cover refresh, cancellation and API fallback; nine synthetic
browser cases cover three modes on desktop, phone and tablet, including failed
direct MinIO images. This is not physical-device or live-provider acceptance.

Production validation: migrations 016–019 are active; signed URL delivery was
checked end to end with a synthetic Kiosk upload and returned `private, no-store`
bytes through the public HTTPS endpoint. API health reports the PostgreSQL queue
and storage ready. Physical phone acceptance remains a manual check.
