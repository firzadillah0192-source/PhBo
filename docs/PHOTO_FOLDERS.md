# Photo folders — phase1 implementation handoff

Owner approved continuation after reviewing USER_PHOTO_STORAGE_PROPOSAL.md.
Folder web/share deployed with owner approval on2026-10-18. SQL026 applied
after verified backup. Live release: photo-folders-20261018T084345Z.
`PHOTO_FOLDERS_ENABLED=true` in live API/worker; source default remains false. No MinIO IAM/bucket/endpoint changes.

## Behavior

My Creations adds flat user-named folders, All photos / Unfiled, default folder,
rename, move, and folder sharing. Names are normalized Unicode,1–80 characters;
case/compatibility-normalized duplicates return409. Maximum100 active folders
per account; maximum20 active share links per folder. Folder operations require
an active signed-in account. Guests and kiosk/event workflows retain their
existing behavior. Explicit folder selection on guest/kiosk generation returns422.

The selected/default destination is recorded atomically with job reservation;
failed creation rolls back its charge/destination. Explicit null means Unfiled;
omitted folder uses the server default. Idempotency includes explicitly supplied
folder_id; changing it under the same key returns409. Destination deletion during
a queued/processing job causes completion to place the photo in Unfiled. Failed
jobs create no folder photo. Existing and guest-claimed photos are Unfiled without
bulk backfill. User preference is server-stored; the UI reloads it on account
changes and offers a destination select before capture/review.

Folders are PostgreSQL metadata. Existing result ID, MinIO object reference,
QR/claim, charge and immutable result expiry are not rewritten. No copies of
photos are created. Deleting a folder unfiles its photos, clears defaults and
pending destinations and revokes its folder shares; it does not delete images.
Existing individual photo deletion remains available with its confirmation.

Lists/counts show completed, paid, nondeleted, non-kiosk, unexpired final results.
Expiry uses subscription_v2_results or legacy14-day fallback. Delivery repeats
existing ownership/payment/retention checks. Sharing/moving does not consume extra
quota or extend retention; Free150MB/7d through Max4GB/90d still apply.

Shares show live contents, with a warning before creation: new additions become
visible; moving a photo out removes it. Link validity1minute–90days never extends
individual result expiry. Only a SHA256 token hash is stored; plaintext token
is shown at issuance only. Revocation, folder removal, photo expiry/deletion and
owner suspension deny new share/media requests. Share images are proxied through
share-authorized endpoints, avoiding reusable owner links. Already downloaded
copies and in-flight responses cannot be withdrawn. Safe paginated metadata has
no account email, prompts, provider or model details. Shared UI lives at /s/:token;
frontend/backend analytics redact share tokens. Public routes set no-store and
no-referrer/noindex headers; existing API cache/origin policies are retained.

## Contracts

Owner cookie routes (existing signed account session):

| Method/path | Body / response |
| --- | --- |
| GET /api/account/photo-folders | {folders:[{id,name,count,created_at,updated_at}],default_folder_id} |
| POST /api/account/photo-folders | {name} →201 folder |
| PATCH /api/account/photo-folders/:id | {name} →folder |
| DELETE /api/account/photo-folders/:id | 204; unfiles, clears defaults and revokes shares |
| PUT /api/account/photo-folders/default | {folder_id:string|null} →{default_folder_id} |
| GET /api/account/photos | ?folder_id=<id> or unfiled; omit for All; limit1–50(default20),cursor; →{photos,next_cursor} |
| PUT /api/account/photos/:resultId/folder | {folder_id:string|null} →{result_id,folder_id} |
| GET /api/account/photo-folders/:id/shares | {shares}; no token recovery |
| POST /api/account/photo-folders/:id/shares | {expires_at:ISODate} →201 {...share,mode:live,share_url} |
| DELETE /api/account/photo-folder-shares/:id | 204; revoke |
| POST /api/generations | existing body + optional folder_id:string|null |

Unauthenticated401; unknown/cross-owner folder/result404; malformed body/cursor422;
duplicate name or configured limit409. Cursor encodes created_at+result_id for
stable descending pagination. Existing _request cache nonce is accepted. Account
route middleware is restricted to folder paths; guest /account/usage remains
available. GET /api/account/usage adds photo_folders_enabled when v2 is enabled.

Public share routes (token in share link; no S3 credentials):

- GET /api/public/photo-folders/:token →{folder:{name},mode,expires_at,photos,next_cursor}.
- GET /api/public/photo-folders/:token/photos/:id/image or /download →authorized
  photo bytes. The photo must still be in that shared folder and available.
- Revoked/expired/unavailable shares404. Invalid filters422. Public rate limit120/min.

Read-only external REST Storage API (requires separately prepared Public API025
and private PUBLIC_API_KEY_PEPPER; folder feature alone does not enable API keys):

- GET /api/public/v1/storage/folders — owner's folder catalog/default.
- GET /api/public/v1/storage/photos — same folder/cursor filters as owner photos.
- GET /api/public/v1/storage/photos/:id/image or /download — owner-authorized bytes.
- Requires an existing integration key with results:read scope; same ownership as
  that key's account. No storage mutation routes. Generation still requires the
  independent generations:create scope; API Basic request may include folder_id.
- Existing public API key management routes create/revoke/rotate credentials;
  never send upstream provider keys or MinIO server credentials to integrators.

## Storage and deployment boundaries

Phase1 leaves bucket nxbooth-production and all object keys intact. These REST
routes use existing private MinIO delivery. They do NOT provide native S3 access,
per-user IAM identities or S3 access keys. Those remain phase2 from the reviewed
proposal, including prefix/legacy/guest coverage and expiry-aware direct-S3 access.
Do not advertise S3 compatibility as delivered by phase1.

SQL026 creates only photo_folders,photo_folder_preferences,
generation_folder_destinations,photo_folder_results,photo_folder_shares, with
indexes and composite foreign keys preventing cross-account folder references.
No Prisma schema migration/db push. Requires existing production tables and
subscription migration024. Public API025 is optional for folder web/share, and
required only to activate key-based REST endpoints. Do not apply025 implicitly.

Activation after explicit owner approval: verified metadata backup, manually
apply026, deploy isolated API+worker+frontend with PHOTO_FOLDERS_ENABLED=true and
SUBSCRIPTION_V2_ENABLED=true. API and worker must agree; startup checks schema
read-only. Preserve peer Public API/footer work and the currently deployed model
fix. Do not copy the entire dirty workspace into production. Retain rollback
images/override; folder metadata is additive and can be retained when disabling
only the folder flag. Do not disable subscription v2 as a folder rollback.

Validation/evidence is recorded under test/output/photo-folders/ and the task's
final handoff. Production deploy requires a separate approval. No commit/push.

## Completed validation and prepared candidate

Backend276 PASS,1 existing MinIO skip; frontend112 PASS. Full typecheck, backend
build and frontend build PASS (existing chunk-size warning). Disposable PostgreSQL
and actual Express HTTP folder integration PASS: two-owner isolation, duplicate
names, transaction rollback, real generation reserve/complete hooks, idempotency,
default selection, rename/move preserving object refs and charge/expiry, share
revocation/expiry/membership, unpaid/expired/kiosk filtering, pagination, deletion
during processing, guest/kiosk rejection, and key-scope read-only REST routes.
Guest /account/usage remains reachable and feature-disabled routes stay404.
Only synthetic fixtures were used; disposable PG was removed by verified ID.

Browser flows PASS at1440/390/320: create/rename/default/move/share/revoke/delete,
destination select, public gallery/privacy metadata and no horizontal overflow.
Visual review adjusted controls to existing retro theme. A cold Vite dependency
graph can reload the browser; the acceptance runner warms the complete App graph
before testing form interactions. Final isolated-candidate run PASS, including
full App rendering. Evidence: test/output/photo-folders/implementation-report.json.

Prepared release: /srv/photobooth/releases/photo-folders-20261018T084345Z.
Images: photobooth-express:photo-folders-20261018T084345Z,
photobooth-express:photo-folders-20261018T084345Z-worker,
photobooth-web:photo-folders-20261018T084345Z. Isolated source preserves live model
fix, excludes peer Public API wiring and unfinished AI footer changes. The
external-key Storage API source is tested in the workspace but is NOT enabled
by this candidate; it needs its separate Public API025/config activation.
Existing nginx and inherited /v2 fingerprint unchanged. Prepared compose config
validated without printing secrets. Two earlier preparation guards failed before
images/deployment; manifests record them and the final candidate is PASS.

Deployment tool: python3 -I scripts/deploy_photo_folders.py status|deploy. Deploy
backs up/verifies the metadata archive, drains old jobs and manually applies only
026 before switching API/worker/web; rollback retains additive folder tables and
keeps subscription v2 accounting enabled. Owner approval is still required.
Live stack remains generation-route-fix API/worker + subscription-v2 web. No
production SQL/photo/IAM/config change, deployment, commit or push in this task.

## Production deployment and real-flow acceptance — 2026-10-18

Owner explicitly approved backup, SQL026 and folder-web deployment. Verified
backup: /srv/photobooth/backups/pre-photo-folders-20261018T084345Z.dump (archive
listing verified and SHA256 recorded in release manifest). Only026 applied;025
remains unapplied. API/worker/web use the prepared photo-folders image tags
listed above. Only those three containers changed. Startup logs, health through
port3000 and public HTTPS,0 restarts and regenerated compose snapshot PASS.
nginx and inherited /v2 fingerprint unchanged. No IAM/bucket/endpoint changes.

Real production HTTP+worker acceptance used a new synthetic account, visibly
marked NXBooth Synthetic Folder Acceptance, with artificial solid-color PNGs.
PASS: folder create/rename/default/duplicate409; real Classic completion in
default folder; replay same job/no double charge;10 Classic Credit; MinIO
download SHA256; live-folder list/download; moving out removes share access;
original QR survives move; share revocation404; expiry and quota preserved;
folder deletion unfiles images and retains QR. Actual compiled web+API browser
checks PASS at1440/390. Test photo/folders removed; counted storage returned0
and spent Classic balance stayed490. Sessions logged out and test uploads keep
normal TTL. Synthetic accounts are retained for audit (two preliminary signup
checks assumed a nonexistent response ID field before the runner was corrected;
those accounts contain no generated photos). No customer data was used, no AI
provider calls or payment orders were made.

Evidence: release live-verification.json/live-acceptance.json and
test/output/photo-folders/live-acceptance.json plus live screenshots. Anonymous
folder routes401, guest usage200 with feature flag, frontend asset exact match
and Public API storage route404 all verified. API-key Storage API and direct
S3/IAM access are still NOT activated. No commit/push.
