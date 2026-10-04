# Upstream adoption: web and Kiosk

Source: downloaded `origin/master`, commit `4ee0aa9`.
Production follow-up: Kiosk and PostgreSQL dispatch were activated on
2026-10-04; see `NATIVE_KIOSK_RELEASE.md`. Migration 019 and signed MinIO
delivery were subsequently activated. This document records the current state.
Operator decision on 2026-10-04: the source repository focuses on Kiosk. Keep
the current NXBooth web workflow and add the Kiosk features alongside it.
Do not replace web account credits with photo-session quotas.

## Running web application

Verified on 2026-10-04: `photobooth-express` runs
`dist/migration-server.js`; `photobooth-express-worker` runs
`dist/migration-worker.js`. Both use the native Express/TypeScript modules.
HTTP requests follow route → controller → service → model → Prisma/PostgreSQL.
Python is a private image helper, not the former application API.

MinIO is active for customer uploads, generated Results, and managed catalog
assets. The existing metadata tables, IDs, credit ledger, and ResultClaim links
remain authoritative. See `NATIVE_MINIO.md` for backfill results and the eleven
historical Results whose original files were already absent.

## Adoption inventory

| Source feature | Current web/runtime | Remaining |
| --- | --- | --- |
| Express controllers, services, models, Prisma | Active native runtime | Reuse these boundaries |
| TypeScript worker and private Python image bridge | Active | Reuse worker and print/composition helpers |
| MinIO private objects | Active for uploads, Results, catalog | Preserve current ownership checks |
| MinIO browser presigned URLs | Enabled for the HTTPS endpoint `storage.gennexbyte.com`; Kiosk refresh/API fallback remains | Physical-device acceptance |
| Idempotency-Key on Generate | Frontend and native API send and validate request keys; migration 016 is applied | None identified |
| API-key Kiosk photo upload | Enabled with a private server-side key | Trusted Kiosk installation/field acceptance |
| Photo-session QR claim before generation | `/claim/:code` and native API are active; existing `/r/:claimToken` remains unchanged | Physical phone acceptance |
| Browser photo-session ownership and expiry | Separate HttpOnly `/api/v1` cookie with expiry checks is active | None identified |
| Per-session generation quota | Separate guest quota, default 3; shared reserve/refund ledger; Classic is free | Operator can tune allocation through environment |
| `/api/v1` Kiosk contracts | Native adapter reuses existing Upload/Generation/Result models and IDs | None identified |
| PostgreSQL queue leases | PostgreSQL dispatch is active; Redis remains for rate limits | None identified |
| Event object namespaces | Uploads and Results support `events/<slug>/...` paths under existing storage policy | Event administration UI is not included |
| Frame management | Current Admin manages reviewed Classic layouts, frame styles, ornaments | Use reviewed slots and 1200×3600 masters; do not replace with automatic geometry/repeated photos |
| Experience presets | Current published registry and Admin edits are active | Reuse published registry; do not overwrite with upstream built-in defaults |

## Native Generate retry protection

`POST /api/generations` optionally accepts `Idempotency-Key` (1–128 ASCII
letters, digits, underscores or hyphens). Requests without the header retain
the existing behavior.

The key is scoped to the account or guest. A SHA-256 digest of the normalized
selection identifiers binds it to its original request. An omitted Advanced
frame style and the explicit `natural` default match. Ordered captures and
ornaments remain part of the digest. Reusing a key with different selections
returns `409 IDEMPOTENCY_CONFLICT`.

A PostgreSQL transaction lock serializes simultaneous retries before creating
the job or reserving credit. The request mapping, job, reservation and ledger
are committed together. Retries return the original job, including completed
or failed state; they do not enqueue again or reserve another credit. A fresh
attempt after failure requires a fresh key. A replay works after its source
upload expires. Existing durable worker recovery handles jobs if a caller
disconnects after transaction commit but before dispatch.

Migration: `backend/migrations/016_generation_request_idempotency.sql`.
It adds only a request-key mapping referencing existing generation_jobs and has
been applied to production.
It has been applied twice on a disposable PostgreSQL 16 database and tested
with eight simultaneous requests, owner separation, changed selections,
quota rollback, and zero-credit Classic creation. The frontend persists only
the safe request key in sessionStorage, with an in-memory fallback.

Current validation: Express suite 110 passed and one optional MinIO integration
test skipped; frontend suite 66 passed; both production builds and TypeScript
build passed; dedicated disposable PostgreSQL integration and
`git diff --check` passed. Live signed MinIO delivery was smoke-tested with a
synthetic image. No physical camera or live-provider quality test was run.

## Kiosk implementation follow-up

Native Kiosk API and frontend claim entry are implemented and active in
production. Migrations 016–019 are applied; the production API, worker and web
images are recorded in `NATIVE_KIOSK_RELEASE.md`. The Kiosk adapter adds the
source repository's session/claim flow alongside the existing web account,
credit and shared Result/QR workflows.

## Queue and direct-delivery follow-up

PostgreSQL dispatch and signed MinIO delivery are active. The public storage
origin was operator-configured through Cloudflare; API and storage health have
been checked after activation. Redis remains in use for rate limiting.
See `NATIVE_QUEUE_DELIVERY.md` and `NATIVE_KIOSK_RELEASE.md` for implementation,
validation and rollback details. Remaining manual acceptance is limited to a
trusted physical Kiosk/browser and live AI provider run.
