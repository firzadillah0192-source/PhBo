# Native Express cutover and rollback plan

This document describes the cutover and rollback procedure. The operator later
authorized and completed the cutover recorded in `MIGRATION.md`.

## Architecture

Use `migration-server.js`, not the imported upstream `server.js`. Native `/api`
routes preserve the existing frontend contract and string IDs. Express owns
authentication, accounts, catalog/Admin, uploads, generation jobs, credit ledger,
provider telemetry, shared Results, claims, and photo deletion.

Use `migration-worker.js` for customer and preview queues. Redis delivers work;
PostgreSQL stores authoritative jobs and credits. Additive worker leases prevent
two workers settling the same job. Expired leases allow durable-job recovery.

The Python image helper runs `basic_api:api` privately. Despite its inherited
filename, it only normalizes photos, composes Classic strips, prepares provider
input, and prepares print output. It does not own application routes or credits.
It still imports the existing Python image modules, so package those modules and
their current HEIC/Pillow dependencies with the helper.

The operator confirmed Basic now uses the AI provider and one credit, just like
Advanced. Classic remains deterministic and free of AI calls/credits. Basic uses
the configured `BASIC_MODEL_EXPERIENCE_ID` catalog model; Advanced uses its chosen
Experience model. This is a deliberate product change, not parity with the old
local Basic identity algorithm. Generated Basic pixels are not guaranteed to be
identical to the old fixed template. Review identity, frame and lettering manually.

## Database and assets

Keep the existing PostgreSQL database and metadata IDs. Do not run the imported
Prisma replacement migrations, `db push`, or quota-reset migrations on it.
Native Prisma models map existing tables; no duplicate account/upload/result or
claim system is introduced.

The only new migration for this runtime is:

`backend/migrations/015_native_worker_leases.sql`

The existing photo-management prerequisite `014_result_photo_deletion.sql` belongs
to the concurrent workstream. Check whether it is already applied; native results
expect `results.deleted_at`. The remaining existing schema migrations must already
be reflected in the database. API startup checks mapped tables; it never migrates
or publishes assets automatically.

Preserve the runtime filesystem and template references, including historical
results and frame/template masters. Back up both database and storage together.
Check read/write ownership for the non-root Node runtime without recursively
changing unrelated directories. Templates must be readable; uploads/results/tmp
must be writable by the appropriate service users.

## Configuration

Use `.env.example` as documentation only. Supply secrets separately.

- Keep the existing `SESSION_SECRET_KEY` so old signed account/guest/Admin cookies
  remain valid. Keep existing session and claim tables and TTL business settings.
- Preserve provider credentials, endpoint and Experience model configuration.
  `AI_PROVIDER=9router` selects the existing abstraction; nothing changes 9Router.
- Set the private `IMAGE_ENGINE_BASE_URL` and shared `AI_ENGINE_API_KEY`.
- Preserve public claim origin `https://nxbooth.gennexbyte.com`, Secure cookies,
  allowed origins, and Admin/Google settings.
- Set `HOST=0.0.0.0` inside a private Docker network. Configure proxy trust only
  when the proxy network is controlled; do not expose the API directly with broad
  trust enabled.
- Use distinct customer and preview queue names. Do not start an old Python
  consumer and a native consumer on the same queue.
- Native `/api` entrypoints use the managed filesystem, not upstream MinIO or
  kiosk-key upload/session-generation counters.

## Proposed operator-controlled transition

1. Review the candidate diff and acceptance evidence. Record current image tags,
   Compose configuration, DB migration state, storage hashes/counts and backups.
2. Rehearse against a disposable database and copied assets; validate historical
   links, cookies, account balances, published catalogs and queue recovery.
3. Perform separately approved live-provider acceptance using a synthetic or
   consented photo, both Basic and Advanced. Confirm actual output, identity,
   themed frame/branding, telemetry and credit success/refund behavior.
4. Build the native image with `Dockerfile.native`. The API uses its default
   `dist/migration-server.js`; the worker uses the same image with command
   `node --enable-source-maps dist/migration-worker.js`. Build/package the private
   Python helper separately with the original image dependencies.
5. In an approved maintenance window, stop new generation submissions, drain or
   deliberately reconcile old queued/processing work, and stop the old consumer.
   Apply the reviewed additive SQL after backup; do not apply replacement schema.
6. Start the private image helper, native API and native worker. Verify dependency
   health, Admin roles, uploads/recovery, every mode, credits and existing claim
   links. Switch the existing `/api` proxy only after checks pass. Keep `/`,
   `/create`, `/r/:token`, Admin and Kiosk routes unchanged.
7. Monitor failures, queue depth, refunds and worker leases. Keep previous images
   and database/storage snapshots available until operator acceptance.

No production Compose file has been changed. Future service work affects
`photobooth-api` and `photobooth-worker`, plus a newly configured private image
helper; frontend rebuild is needed only if its source changes. PostgreSQL and
Redis stay internal and retain their current major versions.

## Rollback

Stop native submissions and consumers first. Reconcile active jobs and reserved
credits before switching to the previous API/worker images. Never let both
consumers settle the same work or blindly replay provider calls. Native Basic jobs
now have provider/credit semantics different from legacy local Basic, so finish
or explicitly fail/refund them under the native runtime before reverting.

Preserve completed Results and their claims. The lease table is additive and can
remain in place; do not drop existing tables or reset quota counters. Restore a
coherent database/storage backup only under explicit operator direction, with
post-backup customer activity accounted for.

## Manual acceptance

- Existing account sign-in, Google login, anonymous free entry and Admin roles.
- Classic: real camera, 3/4 distinct captures, three retakes per session, 10-second
  review, exact 1200 × 3600 master, 600 × 1800 / 300 DPI download, zero credits.
- Basic: the published framed template, mobile upload/camera, one credit reserved
  and spent once, real provider identity/frame/branding review, failure refund.
- Advanced: all ten frame styles, compatible effects, persisted selections after
  refresh, one credit per success, real provider output/telemetry and refund.
- All modes: shared Result, private download, QR page on another phone, revoked
  and expired claims, deletion, ownership restrictions, browser Print boundary.
- Real iPad Safari and Android camera permissions/orientation/HEIC input. Chromium
  device emulation alone does not validate Safari or physical camera quality.
