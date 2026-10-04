# Native Kiosk and PostgreSQL dispatch releases

## Current production state — 2026-10-04

The scoped follow-up release includes migration 019 and enables signed MinIO
delivery after the operator configured `storage.gennexbyte.com` as the public
HTTPS S3 endpoint.

| Service | Current image |
| --- | --- |
| photobooth-express | photobooth-express:kiosk-20261004T131815Z |
| photobooth-express-worker | photobooth-express:kiosk-20261004T131815Z |
| photobooth-web | photobooth-web:kiosk-20261004T131815Z |

Migrations 016–019 are applied. Production has Kiosk enabled,
`GENERATION_QUEUE_BACKEND=postgres`, and signed MinIO delivery enabled. Redis
remains active for rate limits. The immutable Compose override is stored under
`/srv/photobooth/releases/compose.nxbooth-<release-stamp>.yml`.

Public `/api/health` returned healthy database, Redis, MinIO and PostgreSQL queue
checks. A synthetic Kiosk image passed upload → claim → signed URL → public HTTPS
MinIO GET; response was `private, no-store` and was not served from cache. The
synthetic object was deleted. One empty guest audit row remains because its
credit-ledger foreign key prevents session deletion; it has no uploads, jobs,
reserved credits or used credits.

Pre-release backup: `/srv/photobooth/backups/nxbooth-pre-kiosk-20261004T131929Z`.
No credentials are recorded in this document.

## Initial Kiosk activation — 2026-10-04

Deployed on 2026-10-04 following the operator's explicit deployment request.
Source baseline: `main`, starting HEAD `7a53920`; reviewed uncommitted files were
built in an isolated snapshot.

## Running services

| Service | Image |
| --- | --- |
| photobooth-express | photobooth-express:kiosk-20261004T112048Z |
| photobooth-express-worker | photobooth-express:kiosk-20261004T112048Z |
| photobooth-web | photobooth-web:kiosk-20261004T112048Z |

The existing private Python image helper, PostgreSQL, Redis and MinIO services
were preserved. Other projects and global reverse proxy/Cloudflare settings
were not changed. Existing template publication and catalog availability
behavior were preserved; concurrent Admin/pricing/Python/asset changes were
excluded from the release images.

Applied together in a transaction after backup and draining generation jobs:

- `016_generation_request_idempotency.sql`
- `017_native_kiosk_photo_claims.sql`
- `018_postgres_generation_dispatch.sql`
- `019_generation_snapshots_worker_attempts.sql` was added in the scoped follow-up.

Production has `NATIVE_KIOSK_ENABLED=true` and
`GENERATION_QUEUE_BACKEND=postgres`. A private Kiosk key resides only in the
ignored `.env` and server environment. Redis remains active for rate limiting.
The production Compose override is `deploy/compose.native-kiosk.yml`; it
preserves the previous Compose layers and only replaces the three images and
the new feature settings.

At initial activation, `MINIO_SIGNED_URLS_ENABLED=false` because the public S3
endpoint was not configured. The current follow-up state above enables signed
delivery through the operator-configured HTTPS endpoint.

## Release validation

- Initial isolated release snapshot: 108 backend tests passed, one optional MinIO test
  skipped; 54 frontend tests passed. Both production builds passed. Counts are
  smaller than the full worktree because unrelated tests/edits were excluded.
- Disposable PostgreSQL integration passed, including migration repetition,
  request/claim races, quota/refund behavior, dispatch deduplication, concurrent
  dequeue and worker lease recovery.
- Nine synthetic browser cases passed on the exact release snapshot.
- Production synthetic Classic verification passed: four uploads, QR photo
  claim, idempotent Generate retry, PostgreSQL worker completion, MinIO Result,
  shared ResultClaim, 1200×3600 master and 600×1800/300 DPI print export.
  Provider run count and AI credit reservations for this job were both zero.
  Its synthetic session was closed immediately; audit/Result rows were retained
  for release review and its uploads follow the normal retention policy.
- Public landing, chooser and all three published mode galleries passed in
  Chromium at desktop, phone and tablet sizes without viewport overflow or
  JavaScript errors. Screenshots: `test/output/kiosk-deployed/`.
- Public `/api/health` reports healthy database, Redis, storage and PostgreSQL
  dispatch. Public homepage returns HTTP 200 and Cloudflare `DYNAMIC`.
- Nginx configuration passed. Trusted Kiosk upload batches allow up to 50 MiB;
  the ordinary proxy limit remains 16 MiB and the API validates individual files.
- Key absence from the built browser bundle and `git diff --check` passed.

No physical camera or live AI provider generation was tested. Provider health
only indicates configuration, not generation quality. No public event was
created or event administration UI added.

## Rollback records

Private backup directory:
`/srv/photobooth/backups/nxbooth-pre-kiosk-20261004T112753Z`.
It contains the pre-release database dump/environment, previous Compose/image
references, reviewed source archive, image IDs, migration hashes and validation
logs. Old images remain available. Rollback requires coordinating API/worker
dispatch configuration after draining active work; additive migration tables
can remain. Do not restore a full database dump over newer customer activity
merely to roll back application images.
