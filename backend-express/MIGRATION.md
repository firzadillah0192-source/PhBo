# Express migration and production record

Imported from `origin/master` of `firzadillah0192-source/PhBo`, commit `4ee0aa9`.
This folder contains the native Express backend now serving NXBooth in production.
The React frontend and existing PostgreSQL, Redis rate-limit, and MinIO services remain active.

## Target

Express + TypeScript owns the production HTTP API, customer workflows, generation
queue, and worker, following the route → controller → service → model structure. BASIC and
ADVANCED both use the NineRouter provider abstraction and reserve one AI credit.
Python remains a private image-processing helper for upload normalization, print
formatting, and the separate Classic compositor; it does not generate BASIC images.

## Local validation

Node >= 22.12; pnpm 11.19.0. From this folder:

```sh
npx --yes pnpm@11.19.0 install --frozen-lockfile
npm run db:generate
npm test
npm run typecheck
npm run build
```

These commands generate the client, compile, and run mocked API/model/provider
tests. They do not apply database migrations or start a worker. Passing them does
not establish production feature parity, real identity quality, or live provider health.

The example environment uses a separate API port (8081), candidate database
(`nxbooth_express_dev`), and storage bucket. Example ports describe intended local
candidate services; no such services are created by the import.
No real provider credentials or production environment file were imported.

`db:migrate`, `db:dev`, and `db:studio` are guarded candidate commands requiring a
dedicated `nxbooth_express_*dev` or `nxbooth_express_*test` database. They reject
production mode and the existing database name. Direct Prisma commands and the
upstream integration test can bypass that wrapper; only run them against explicitly
prepared disposable resources. Do not use these migrations as an upgrade of the
existing database.

The upstream development Compose was intentionally not imported into the app:
its port 3000 and database/storage configuration conflict with the current stack.
The imported Dockerfile is upstream reference code, not an approved production
deployment definition. The private Python helper still needs the existing image
normalization and Classic compositor modules; Basic generation no longer depends on
the local face-fitting engine or its model assets.

## Native API compatibility progress

| Current frontend/API feature | Express candidate state | Required migration work |
| --- | --- | --- |
| `/api/health` | `/health` process liveness | Preserve dependency-aware health contract |
| `/api/templates` | Native published registry and preview for fifteen Basic variants: man, woman, and hijab woman for Space Commander, Cyberpunk Neon, Aviation Captain, Royal Nusantara, and Arctic Expedition | Template selection feeds a private NineRouter prompt for Basic |
| `/api/experiences` | Native published DB catalog, thumbnails and Admin editing | Live-provider review remains manual |
| `/api/classic/layouts` | Native existing IDs, 35 reviewed masters, metadata and compositor | Physical camera/device acceptance remains manual |
| `/api/advanced/frame-styles`, `/ornaments` | Native presets, Admin editing and compatibility checks | Experience content review remains manual |
| `/api/uploads`, upload recovery | Native guest/account ownership, storage, metadata and expiry | Schedule retention cleanup in candidate runtime |
| `/api/generations`, polling | Native three-mode creation, persisted selections, Redis consumer and crash recovery | Live provider/device acceptance remains manual |
| AI credit reservation/refund | Native atomic reservation/settlement for Basic and Advanced; Classic is free | Live-provider lifecycle acceptance remains manual |
| `/api/results`, `/api/public/results`, `/r/:claimToken` | Native shared Result/claim, download, Classic print, QR and deletion | Real-phone QR acceptance remains manual |
| Account, Admin, usage/pricing | Native password/guest/Google auth, Account Center, Admin roles, usage and photo management | Billing provider intentionally not enabled |
| HEIC upload ingestion | Private Python image-only normalization using original decoding | Physical mobile browser/HEIC acceptance remains manual |

Do not point the existing frontend at this candidate until those contracts are
implemented and tested. The candidate reads existing catalog tables; it does not
import assets or publish registry records. Native routes are implemented in
`migration-app.ts`, separate from the upstream `/api/v1` application and its
incompatible quota/schema. No unported application route forwards to FastAPI.

## Next implementation slices

1. Review `CUTOVER.md` and configure a private image-helper/provider environment.
2. Run live-provider acceptance with synthetic or consented photos; automated
   provider tests use a marked HTTP test double and do not establish identity
   quality.
3. Rehearse backup, additive migration and storage permission steps, then schedule
   a separately authorized cutover. No production switch is part of this work.

The candidate was initially validated without production changes. A later,
operator-authorized cutover is recorded below.

## Candidate foundation validation — 2026-10-03

- Frozen-lockfile install: passed, pnpm 11.19.0 / Node 22.23.2.
- Prisma client generation: passed, Prisma 7.10.0; no SQL applied.
- API/model/engine/configuration tests: 44 passed, 0 failed.
- TypeScript typecheck: passed.
- TypeScript production build: passed.
- PostgreSQL/MinIO integration and live Python/provider generation: not run.
- Existing frontend/backend suites: not rerun; their source and routing were unchanged.

This validates the imported foundation, not completed feature migration.

## Native migration validation — 2026-10-03

Implemented route → controller → service → model boundaries against existing
lowercase table names and legacy string IDs. Prisma models are read/write mappings,
not a replacement SQL migration. No production database changes were applied.

- Unit/API/model/config suites: 77 tests, including the imported foundation tests.
- Disposable PostgreSQL catalog integration: all 35 real reviewed Classic frame
  assets and metadata, framed Basic publication, published experiences, ten styles.
- Disposable PostgreSQL account/upload/generation integration: ownership and
  recovery, atomic credit reservation/rollback/refund, persisted selections,
  polling, all-mode shared Result/QR/download, deletion and Classic print export.
- Actual Classic execution: native API job → Python/Pillow using explicit reviewed
  slots → native Result/claim. Duplicate delivery creates one Result, zero credits.
- Disposable Redis integration: LPUSH/BRPOP FIFO, concurrent enqueue and unavailable
  Redis handling. No public port or network and no connection to live Redis.
- Three private Python image API tests: real synthetic HEIC fixture, JPEG EXIF,
  transparency normalization, explicit Classic metadata/count rejection and overlay.
- TypeScript typecheck/build and candidate whitespace checks are recorded separately
  from integration tests; rerun the commands below when making further changes.
- Frontend tests: 52 passed; frontend production build passed.
- Real Redis consumer acceptance: FIFO, concurrent enqueue, rate-window counter and
  unavailable-socket handling passed.
- Browser acceptance against an isolated Express API and Redis worker: desktop,
  Android Chrome emulation and iPad layout passed landing, all modes, Result, QR,
  download, refresh persistence and Admin checks. Provider was a test double;
  iPad Safari and physical camera quality were not tested.
- Original SQLAlchemy schema rehearsal: 24 Prisma mappings read successfully and
  migration 015 applied twice idempotently on disposable PostgreSQL.

Advanced worker database success/failure tests use clearly marked synthetic engine
output. They establish accounting behavior, not real AI generation, identity quality,
provider connectivity or telemetry parity. The local Basic identity engine was not
run through the native pipeline and is no longer part of the candidate. Classic is
the only local image compositor. No native worker process is enabled.

The composer is tested byte-for-byte against the CURRENT Python implementation
for all ten style prompts. Current ornaments are camera effects and are not inserted
into AI prompts. Current branding direction asks the provider for themed footer
lettering and uses print preparation preserving the generated frame. This migration
does not silently revert those concurrent product changes to the original proposal.

### AI-only Basic update — 2026-10-03

The Native Express candidate now routes both BASIC and ADVANCED through
`NativeAIProvider`. Basic builds its
prompt from the registered template name/description, and snapshots the configured
server-side model with the queued job. The local Python face-fitting route and its
Express bridge call were removed. BASIC and ADVANCED both reserve one credit and
refund it on queue/worker failure. The private Python service remains for upload
normalization, print preparation, and Classic composition.

Provider calls in tests are mocked; no live NineRouter request was made. This change
does not activate the candidate worker or switch the running beta/API.

## Production cutover record — 2026-10-03

The operator then authorized direct migration while explicitly skipping live
provider-quality and physical-camera acceptance. Before switching traffic:

- PostgreSQL backup: `/srv/photobooth/backups/nxbooth-pre-express-20261003T133324Z.dump`
- Runtime backup: `/srv/photobooth/backups/nxbooth-runtime-pre-express-20261003T133324Z.tar.gz`
- Additive `backend/migrations/015_native_worker_leases.sql` applied successfully.
- Express image: `photobooth-express:prod-20261003T133324Z`.
- Private helper image: `photobooth-image-helper:prod-20261003T133324Z`.
- Frontend image: `photobooth-web:express-20261003T133324Z`.
- `/api` proxy now targets `photobooth-express:8081`.
- `photobooth-express`, `photobooth-express-worker`, and the private helper are
  healthy. The old FastAPI API remains running for rollback; the old FastAPI
  worker is stopped so only the native worker consumes generation work.
- Public smoke-check passed: health, 1 framed Basic template, 35 Classic layouts,
  10 frame styles, 3 ornaments, 44 published Experiences and the NXBooth landing
  page. API responses are dynamic/no-store.

Live provider output quality and physical camera acceptance were intentionally not
run per operator instruction. The cutover is operationally complete, with those
checks remaining a manual product review.

### Repeating isolated integration validation

Prepare a disposable `nxbooth_express_*test` PostgreSQL database, network-disabled
Redis with a Unix socket under `/tmp/nxbooth-express-redis-test-*`, and the image-only
Python Uvicorn app on a Unix socket under `/tmp/nxbooth-express-image-test-*`.
Mount existing Python engine modules read-only; use synthetic images and a test-only
engine key. Run catalog and account tests sequentially because their fixtures share
table names. Tests reject an unapproved database/socket name before touching data.

```sh
TEST_DATABASE_URL="$candidate_test_database" npm run test:catalog-integration
TEST_DATABASE_URL="$candidate_test_database" TEST_IMAGE_ENGINE_SOCKET="$candidate_image_socket" npm run test:account-integration
TEST_REDIS_SOCKET="$candidate_redis_socket" npm run test:queue-integration
```

The Python test requires `MIGRATION_HEIC_FIXTURE` pointing to the repository's
`backend/tests/fixtures/synthetic-oriented.heic`. Execute its unittest discovery
inside an isolated Python environment with the existing image dependencies.
Dispose only the dedicated test containers after validation.

### Cutover blockers

Physical camera and iPad Safari acceptance and live-provider identity/branding
quality remain manual. The Express runtime, MinIO storage, Kiosk routes, signed
delivery and PostgreSQL generation dispatch are active; the deployed release and
database backup are recorded in [NATIVE_KIOSK_RELEASE.md](docs/NATIVE_KIOSK_RELEASE.md).
