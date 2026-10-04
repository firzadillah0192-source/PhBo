# Native Kiosk photo claim adapter

Implemented 2026-10-04 against the operator-approved upstream concept.
Production activation and validation are recorded in `NATIVE_KIOSK_RELEASE.md`.
The earlier validation/activation notes below describe the pre-release state.

## Workflow

Trusted Kiosk software uploads one to four photos with `X-API-Key`. The API
normalizes each photo through the existing private image helper and writes it
using the existing Upload service (MinIO when production storage is enabled).
The response includes `/claim/:code#token=...`. Browser claim consumes that token
once, creates an HttpOnly `photo_session` cookie scoped to `/api/v1`, and removes
the token from browser history after successful claim/recovery.

The browser chooses Classic, Basic or Advanced using the existing mode cards,
published catalog galleries, Advanced style/ornament controls, polling helper,
and shared ResultStage. It chooses from the already captured Kiosk photographs;
this flow does not request another camera capture. Classic requires exactly the
layout's reviewed shot count, preserves photo order, and uses the existing
compositor/master profile. Basic and Advanced use the same provider/worker
pipeline as web generation.

## Identity and quota

Each upload session has a dedicated existing guest_sessions identity with a
configurable initial allocation, default three AI generations. No new accounts,
Uploads, Results, generation job or ResultClaim tables are introduced. Existing
web login/guest cookies and balances are untouched. The initial Kiosk allocation
is recorded in the existing credit ledger. The shared transaction reserves one
credit for Basic/Advanced and settles/refunds it through the existing worker.
Classic creates no credit reservation.

Generation requires `Idempotency-Key`. The session ownership, validity, selected
photo membership, optional event restrictions, job creation, request mapping and
credit reservation are checked before dispatch. Eight simultaneous claims have
one winner; eight simultaneous generation retries return one job and reserve
one credit. Failed generation/refunded credit can fund a new attempt with a new
request key. The original key remains bound to its original job.

## Routes

Mounted only when `NATIVE_KIOSK_ENABLED=true`:

| Method | `/api/v1` route | Access |
| --- | --- | --- |
| POST | `/photo-sessions`, `/upload-image` | Trusted Kiosk API key |
| POST | `/photo-sessions/:code/claim` | One-time claim token |
| GET | `/photo-sessions/:code` | Claimed session cookie |
| GET | `/photos/:id`, `/image/:id` | Claimed session cookie |
| POST | `/generations` | Claimed session cookie and Idempotency-Key |
| GET | `/generations/:id` | Claimed session cookie |
| GET | `/photo-sessions/:code/generations` | Claimed session cookie |
| GET | `/frames`, `/templates`, `/experiences`, `/frame-styles`, `/ornaments` | Published public catalogs |
| GET | `/results/:id`, `/results/:id/image`, `/results/:id/download` | Claimed session cookie |
| POST | `/results/:id/claim` | Claimed session cookie; existing ResultClaim model |

Frontend `/claim/:code` handles Kiosk photo claims. Existing `/r/:claimToken`
continues to open completed Result claims. The existing `/kiosk` web camera
workflow and regular customer `/api` routes remain available independently.

Request IDs intentionally preserve existing NXBooth IDs: uploads/jobs use
32-character hex IDs; Classic layouts and templates/experiences retain registry
identifiers. The adapter accepts upstream camelCase selections (`sessionCode`,
`photoIds`, `frameId`, `templateId`, `experienceId`) and adds `frameStyleId` and
`ornamentIds`. Responses use `{data: ...}`. Photo responses never expose private
filesystem paths, object references, claim hashes, access hashes or guest IDs.
Admin frame edits stay behind the existing reviewed-layout Admin API; this
adapter does not enable the upstream unrestricted PNG frame CRUD.

## Events

Optional multipart `event` is a slug of a published, currently active event.
Session metadata includes event-compatible modes, template/experience IDs and
an optional assigned Classic layout. The browser filters the published catalog
using those restrictions; generation rechecks them transactionally. No event
means the global published registry is available. Event configuration retains
the table names/contracts from migration 011; no new event management UI or
automatic event publication was added.

## Configuration and migration

Default: `NATIVE_KIOSK_ENABLED=false`. Production explicitly enables it through
the immutable release Compose override; an upstream `KIOSK_API_KEY` alone
cannot activate the adapter.

- `KIOSK_API_KEY`: at least 32 characters, only in trusted Kiosk software/server
  environments. Never included in the browser bundle.
- `KIOSK_GENERATION_LIMIT`: 1–100, default 3.
- `KIOSK_PHOTO_SESSION_TTL_SECONDS`: 60–604800, default 86400. Actual expiry is
  bounded by existing upload retention so a session cannot outlive its photos.
- Secure cookies are enforced by the existing production cookie policy.
- QR URL uses the existing validated Result claim public origin.

Additive migrations applied to production:

1. `016_generation_request_idempotency.sql`
2. `017_native_kiosk_photo_claims.sql`
3. `018_postgres_generation_dispatch.sql`
4. `019_generation_snapshots_worker_attempts.sql`

Read-only production inspection found none of the event/Kiosk/request tables on
2026-10-04. Migration 017 therefore creates the existing event/Kiosk contracts
if absent, extends them if present, and adds their Upload/job references. It
does not insert the older migration 011 Classic strip seed or publish any
event/layout/template. Startup checks the Kiosk and idempotency schemas when the
feature is enabled. All four migrations were validated repeatedly on a
disposable PostgreSQL 16 database and applied transactionally to production
after a backup.

Failed/incomplete upload sessions are marked FAILED; uploaded objects retain
the existing bounded upload retention and cleanup policy. Expired claims cannot
read photos or generate. Guest/session audit metadata is not proactively
deleted by this feature.

## Validation

- Current Express suite: 110 passed, one optional MinIO integration test skipped.
- Current frontend suite: 66 passed.
- TypeScript/build: passed; frontend production build: passed.
- PostgreSQL integration: claim races, retry races, owner isolation, independent
  Kiosk quota, exhausted quota, refund, exact Classic capture count, zero-credit
  Classic, shared Result/QR and real synthetic PNG download/print all passed.
- Event compatibility and expired-event uploads were rejected as expected.
- Migration tested with prior Kiosk tables and without prior Kiosk tables;
  repeated application preserved the reviewed layout catalog without seeds.
- Chromium local browser checks: three modes × desktop/phone/tablet, refresh,
  lost Generate response/reused key, and viewport overflow passed. API/image
  fixtures are explicitly synthetic. This is not live provider quality or a
  physical device/Safari acceptance claim.
- `git diff --check`: passed.
- Physical camera and live-provider quality checks were not run. Production
  activation and signed MinIO smoke results are recorded in
  `NATIVE_KIOSK_RELEASE.md`.

Synthetic browser screenshots: `test/output/kiosk-claim/` (not production assets).
Browser script: `frontend/scripts/kiosk-claim-browser-check.mjs`.
Database script: `npm run test:kiosk-integration` with a dedicated
`nxbooth_express_*test` database only.

## Post-activation acceptance still available

For field acceptance, upload 3/4 consented synthetic test photographs from
trusted Kiosk software, scan the QR on a phone, verify all three modes,
refresh/polling/credit settlement, shared Result QR, download and Classic print
dimensions. Confirm the ordinary web account balance and existing `/r` links
still work. Physical camera/provider testing remains the operator's choice.

Remaining product work from the upstream repository is optional event
administration UI and physical-device acceptance. Signed delivery uses the
operator-configured `storage.gennexbyte.com` HTTPS endpoint. This Kiosk feature
supplements the existing web product.
