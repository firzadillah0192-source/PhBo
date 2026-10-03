# NXBooth backend restructure assessment

Reviewed 2026-10-03. Scope: fetch and source review, before migration.

## Subsequent decision and candidate import

The operator selected a full Express + TypeScript backend migration, retaining the
Python image engine boundary from the new repository. A separate candidate now
exists at `backend-express/`; see [its migration plan](../backend-express/MIGRATION.md).
The imported foundation passed 44 automated tests. Subsequent native migration work
adds catalog, account/guest, uploads/recovery, generation creation/polling, Advanced
credit ledger, shared Result/claims and real reviewed Classic image composition.
See the candidate migration plan for current validation and remaining cutover
blockers. Production and the current frontend are not switched over. The source-only
review and gaps below describe the upstream baseline, before feature migration.

## Repository state

- Remote: `firzadillah0192-source/PhBo`.
- Existing application: local `main`, starting commit `c354ffb`.
- Remote `main`: `343fbd1`.
- New backend: remote `master`, commit `4ee0aa9`.
- Detached review checkout: `/tmp/nxbooth-restructure-review`.
- `git merge-base main origin/master` returns no common ancestor. This is a separate history, not a normal incremental update to the current backend.
- Existing uncommitted backend, Admin, pricing, photo-management, and frontend changes were preserved. No merge, reset, stash, deployment, or production SQL was performed.

## Architecture discovered

New request path:

```text
Express route -> controller -> service -> model -> Prisma -> PostgreSQL
                                      -> MinIO
PostgreSQL generation queue -> TypeScript worker -> Python bridge / 9Router
```

`src/container.ts` wires dependencies. Controllers parse requests and build responses; services own workflow; models own persistence. This separation is useful and can be retained during migration.

| Area | Existing application | New backend |
| --- | --- | --- |
| API | Python/FastAPI | Express 5 / TypeScript |
| Database access | SQLAlchemy, existing SQL migrations | Prisma 7, new schema and migrations |
| Queue | Redis and Python worker | PostgreSQL leases and TypeScript worker |
| Image storage | Managed runtime filesystem | MinIO objects and signed URLs |
| Image processing | Python/Pillow and existing Basic engine | Sharp, Python Classic/Basic bridge |
| API prefix | `/api` | `/api/v1` |
| Customer entry | Anonymous/account web upload | Kiosk API-key upload, then browser claim |

The new repository does not contain the current customer frontend or managed template/frame assets.

## Compatibility gaps to resolve

### API and sessions

Evidence: `src/routes/index.ts`, `src/objects/requests.ts`, `src/objects/responses.ts`, `src/controllers/photo-session.controller.ts`.

- New uploads require a Kiosk API key. That key must never be shipped to the browser. Preserve public web upload with server-side identity checks.
- Requests use `sessionCode`, UUID photo IDs, and an `Idempotency-Key`. Current requests use `upload_id`, layout/template/experience IDs, and capture upload IDs.
- Responses wrap payloads in `{ data: ... }`; generation responses use `id`/`status` rather than the current `job_id`/`state` contract.
- Preserve upload recovery, server-authoritative selections, account/guest ownership, and existing deep links through an adapter or deliberately coordinated frontend changes.

### Database and existing data

Evidence: `prisma/schema.prisma` versus current `backend/app/models.py` and authentication models.

The new schema has four main entities: `Frame`, `PhotoSession`, `Photo`, `Generation`. It does not provide the current account/guest authentication, credit ledger, shared Result/ResultClaim, managed Experience, frame-style, ornament, or Admin-role schemas.

Current IDs include string IDs and slugs; new entities use UUIDs. Preserve public identifiers or maintain explicit mappings. Preserve existing results, claims, balances, asset references, and history. The six Prisma migrations are not a conversion of the current SQLAlchemy database.

### Classic

Evidence: `python-worker/classic_compositor.py`, `src/services/image.service.ts`, frame responses and Prisma Frame schema.

- The compositor has deterministic EXIF-aware cover fitting and frame overlay.
- It detects openings from alpha at runtime and repeats captures when there are fewer photos than slots.
- It lacks the existing reviewed slot metadata, exact shot-count enforcement, event/theme catalog, and frozen 1200 × 3600 / 1:3 print profile.
- Frame responses lack shot count and slot metadata required by the current capture UI.
- Preserve the current three-retake budget, 10-second photo review, and distinct capture count. Do not replace explicit reviewed geometry with automatic detection.
- Sharp output normalization and PNG saves need explicit print-metadata handling.

### Basic

Evidence: `python-worker/basic_api.py`.

- The bridge calls the original Python Basic engine; it depends on original application modules, dependencies, registry, and assets.
- Its default template ID is the older unframed `sci-fi-space-commander-001`. Preserve the published framed template `sci-fi-space-commander-framed-001`.
- Keep the identity algorithm and production parameters unchanged. Verify template frame and branding pixel preservation.
- New Compose does not start this Python bridge; it needs a private service with the correct production engine and asset configuration.

### Advanced

Evidence: `src/services/ninerouter.service.ts`, `experience-presets.ts`, generation request/schema/service.

- Uses a provider boundary and snapshots experience configuration for jobs.
- Requests 1024 × 1024 from the provider. It lacks the current 2:3 master composition and deterministic branding stage.
- No persisted frame-style or ornament selection, compatibility validation, or existing prompt composer.
- Built-in experience presets do not replace the current published registry, previews, and Admin edits.
- Preserve the existing provider behavior and telemetry. Do not change 9Router internals or credentials.

### Credits, results, and Admin

- New quota increments `PhotoSession.generationUsed` for both Basic and Advanced. Current generation code reserves AI credits only for Advanced. Port the existing business rule and ledger rather than adopting the new session quota as a replacement.
- Classic remains outside AI quota and provider calls.
- New upload QR `/claim/:code` claims a photo session. It does not replace the existing result claim `/r/:claimToken`.
- Preserve shared results, download, QR, print boundary, claim expiry/revocation, and existing public links.
- New frame CRUD uses an API key; current Admin authentication, roles, overview, catalog management, pricing, and photo-management work need explicit preservation.
- New Sharp upload normalization does not provide current HEIC ingestion parity.

## Infrastructure differences

Evidence: `compose.yaml`, `Dockerfile`, `src/config/env.ts`.

- New development Compose publishes API on port 3000, conflicting with the existing frontend port.
- It uses PostgreSQL 17; the current stack uses PostgreSQL 16. Do not attach an existing volume to a different major version.
- Development MinIO port exposure, credentials, container names, and network layout need production configuration.
- Keep database, queue, and Python bridge private. Provide safe browser access to signed image URLs through the existing HTTPS setup.
- Production cookies are Secure; replacing the backend will not solve Admin access over plain HTTP LAN.

## New Prisma migration inventory

These belong to the new schema and must not be applied directly to the current production database:

1. `20260925000000_init`
2. `20260928000000_generation_types` — includes a reset of new-schema session quota counters.
3. `20260929000000_engine_routing`
4. `20260929010000_storage_object_keys`
5. `20260930000000_photo_session_access_token`
6. `20261001000000_classic_multiple_photos`

## Proposed migration sequence

1. Decide whether to adopt the full Express stack or apply its controller/service/model organization to the existing FastAPI backend.
2. For a full replacement, define compatibility contracts and extend the candidate schema for existing product features before switching the frontend.
3. Build an isolated candidate stack with a disposable database, private MinIO, and the existing Python Basic engine. Keep current production serving traffic.
4. Implement and dry-run data/asset import with explicit ID mappings, preserving results, claims, ledger, published catalogs, and reviewed Classic slots. Verify counts, hashes, links, and rollback behavior.
5. Run contract, ownership, credit/refund, all-mode generation, recovery, Admin, HEIC, QR, and print-profile tests. Use fake providers for automated tests; evaluate real identity quality separately.
6. Validate the existing frontend against the candidate backend. Perform staging acceptance with operator approval.
7. Plan a separately authorized production cutover and rollback, accounting for jobs already queued or processing. Do not run old and new consumers against incompatible queues.

## Validation status

This is a source assessment, not a validated migration. Repository fetch and isolated checkout completed. No new dependencies installed; no candidate backend tests/build, integration database migration, provider generation, or production deployment performed. Existing tests were not rerun for this documentation-only assessment.

The current production application and unrelated local edits remain in place. No claim is made that the replacement backend is ready for production.
