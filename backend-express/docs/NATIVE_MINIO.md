# MinIO adoption for the native NXBooth runtime

Implementation status: validated code and production activation completed on
2026-10-04. Native API and worker image:
`photobooth-express:minio-20261004T053735Z` (catalog/backfill stage).

Current follow-up: the native Kiosk release uses the same private MinIO bucket
and enables short-lived signed browser delivery through
`storage.gennexbyte.com`. See `NATIVE_KIOSK_RELEASE.md` for the active image,
signed URL smoke check, and current production state.

The imported backend already uses MinIO through `container.ts`. Production uses
`migration-container.ts` to retain existing customer contracts and database IDs.
This change connects MinIO to that active runtime for new customer uploads and
generation Results in all three modes.

## Configuration

Set the same values on the native API and native worker:

```dotenv
STORAGE_BACKEND=minio
MINIO_ENDPOINT=<host reachable by both containers, without protocol>
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=<application access key>
MINIO_SECRET_KEY=<application secret>
MINIO_BUCKET=<private NXBooth bucket>
MINIO_REGION=us-east-1
```

Keep credentials in the server environment only. Pre-create a dedicated private
bucket and a scoped application key with read, write, delete and bucket-existence
permissions. Startup checks the bucket; it does not create buckets or change
policies. API health reports storage readiness without credentials or endpoints.

The inspected existing server is `aistor-server`, listening on host port 9000,
attached to Docker's default bridge. `localhost` inside an Express container is
not that server. The deployment uses `host.docker.internal:host-gateway` via
`deploy/compose.minio.yml`; the application reaches the existing published host
API port. No MinIO network attachment was changed. A private
`nxbooth-production` bucket and scoped application user were provisioned. Keys
remain in the ignored server `.env`; root credentials are not used by the app.

Only the API/worker need MinIO access. Preview, download and QR delivery remain
authenticated or claim-authorized API responses; no public MinIO endpoint,
browser credentials or public bucket are required for this native integration.

## Storage references and compatibility

New references stored in the existing `storage_path` column:

- `minio://uploads/<first-two-id-characters>/<32-character-id>.jpg`
- `minio://results/<first-two-id-characters>/<32-character-id>.png`

Keys are validated before reading/deleting. Image bodies are capped at 25 MiB.
Existing absolute paths continue to use the existing managed-directory checks.
No SQL migration or rewriting of existing records is required for new writes.

Template masters, frame PNGs, marketing previews, template JSON and Admin preview
assets are stored under `minio://catalog/<relative-template-path>`. Existing
absolute catalog references remain valid aliases: reads prefer the mapped MinIO
object and fall back to local files only when an object has not been imported.
Admin replacement uploads now return explicit catalog references. Source preview
generation writes objects too. No new configuration registry was introduced.

Catalog objects are materialized into a private cache under
`/srv/photobooth/cache/catalog`; cache filenames include bucket, key, ETag and
object metadata. Replacement objects get new cache files. Concurrent requests
share a download, and source modification time is preserved for Classic preview
freshness checks. Local source files remain for rollback; keep runtime mounts
and coherent database/filesystem/object backups until retention is reviewed.

Changing back to filesystem-only mode after producing MinIO results would make
those results unavailable. A rollback must retain MinIO reads or migrate their
references/files first. The older production image cannot interpret MinIO refs.

## Failure behavior

Uploads clean up stored objects if database creation fails. Retention skips uploads
used by active jobs and stops rather than scrubbing metadata on a storage outage.
Workers use the existing success/failure/credit settlement logic. Lost ownership
removes an uncommitted object; ambiguous database completion preserves it for
reconciliation. Result deletion removes the exact ID-scoped object before marking
the result deleted and revoking claims through the existing model.

## Validation

`npm test` includes synthetic storage, ownership, historical file compatibility,
claim delivery, Classic print export, cleanup, deletion and worker failure tests.
The real MinIO test is skipped unless `TEST_MINIO_ENDPOINT` is explicitly set.

```sh
npm run test:storage-integration
npm run build
npm run typecheck
git diff --check
```

Real integration configuration uses `TEST_MINIO_ENDPOINT`, `TEST_MINIO_PORT`,
`TEST_MINIO_ACCESS_KEY` and `TEST_MINIO_SECRET_KEY`. It creates only a randomly
named `nxbooth-storage-test-*` bucket, writes synthetic images, verifies byte-for-
byte reads and Result/claim delivery, and removes its object and bucket afterward.
Do not put credentials in command arguments or commit them.

## Production validation record

- Scoped source tests: 83 passed, 1 skipped; the skipped real MinIO test was run
  separately and passed. Full working-tree suite: 84 passed, 1 skipped.
- Build, TypeScript check and `git diff --check` passed.
- Private bucket read/write/delete verified using the scoped application key;
  access to an unrelated object prefix was rejected.
- API and worker restarted with the reviewed MinIO image. Existing template
  release configuration was retained after a concurrent deployment replaced the
  initial MinIO activation with the old image.
- API health reports database, Redis and storage `ok`. Worker startup is clean.
- Internal API smoke using three synthetic Classic captures completed with no AI
  calls or credits: uploads, composition, 1200x3600 master, 600x1800 print export,
  Result claim image/download, deletion and claim revocation all passed.
- A direct request from the image-helper container to the public domain returned
  HTTP 403, so the synthetic workflow ran over the private API hop. Public health
  from the host succeeded. Full public-browser workflow remains a manual check.
- Legacy upload shard directories (88, owner 999/group 1000) lacked group-write
  permission. Only those validated two-character shard directories were granted
  group-write so expired-upload cleanup no longer blocks the native worker.
- Synthetic result/upload objects were removed; test job audit remains. Local
  review outputs: `/tmp/nxbooth-minio-classic-smoke/`.
- Pre-cutover DB backups under `/srv/photobooth/backups/`:
  `nxbooth-pre-minio-20261004T045356Z.dump` and
  `nxbooth-pre-minio-20261004T050335Z.dump`.

The first stage applied no SQL migration and did not backfill historical data.

## Catalog and historical-file stage — 2026-10-04

The subsequent stage backfilled available historical files and catalog assets.
Final production image: `photobooth-express:minio-20261004T053735Z`.

- 267 catalog files copied and verified byte-for-byte with SHA-256.
- 49 historical Results copied; database references switched after verification.
- 8 active historical uploads copied and references switched. Upload expiry and
  source path/hash are rechecked at commit; timestamp equality is intentionally
  avoided because PostgreSQL can retain more precision than JavaScript Dates.
- 11 pre-existing Result records had no source file. They remain unchanged;
  missing images are neither fabricated nor marked as successfully migrated.
  The available pre-Express runtime archive was checked read-only and contained
  no matching filenames for these 11 records. No backup was restored.
- A concurrent workstream updated seven template JSON files during the run.
  Their older MinIO bytes were archived under `catalog/_history/<sha256>/...`;
  newer JSON metadata was synced only with the explicit sync option. Conflicting
  image assets remain rejected, and source files are never overwritten/deleted.
- Final backfill replay: 267 catalog files verified, 57 existing MinIO references,
  zero further reference updates, zero conflicts and zero concurrent-change skips.
  Exit code 2 reports the 11 missing source files and must not be ignored as a
  claim of complete data recovery.
- Full working-tree Express suite: 90 passed, 1 skipped. Scoped image snapshot:
  89 passed, 1 skipped. Real MinIO integration: 7 passed separately.
- Image build, TypeScript and diff checks passed. Admin/customer catalogs and
  Basic/Experience/Classic previews return successfully. Classic synthetic
  composition, print, Result/QR, zero-credit and deletion smoke passed again.
- Public health reports storage `ok`; native worker is healthy with clean logs.
- Latest pre-change DB backup:
  `/srv/photobooth/backups/nxbooth-pre-minio-20261004T054017Z.dump`.

### Repeating backfill

Use the native production image/environment with runtime source volumes mounted
read-only. The command defaults to a dry-run and emits aggregate counts only:

```sh
node dist/migrate-storage.js
node dist/migrate-storage.js --apply
node dist/migrate-storage.js --apply --sync-newer-metadata
```

The last option allows newer valid JSON metadata to replace an older object only
after preserving and verifying the older bytes. It does not authorize replacement
of conflicting PNG/JPEG/WebP/SVG assets. Normal backfill refuses all content
conflicts. Database updates use compare-and-set guards; records deleted or expired
concurrently are not resurrected. Originals and archived versions are retained.

No DDL/schema migration, account/credit/claim changes, frontend deployment,
provider configuration changes or old API revival were required.
