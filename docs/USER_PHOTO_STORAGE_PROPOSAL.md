# User photo folders and direct S3 — review proposal

Status: phase1 owner-approved and implemented in source; candidate prepared.
See PHOTO_FOLDERS.md for tests, activation boundaries and remaining phase2.
Inspected 2026-10-18 after owner requested continuation. No application changes,
SQL application, IAM changes, photo moves, commit or deployment in this task.
Source brief: USER_PHOTO_STORAGE_INBOX.md. Public API implementation is a peer
workstream and not automatically included in this proposal.

## Observed production baseline

Subscription v2 is deployed: subscription-v2-20261018T035402Z (API, worker, web).
Current final-result quota / new-result retention: Free150MB/7d,
Starter500MB/14d, Plus1GB/30d, Pro2GB/60d, Max4GB/90d. Existing results retain14d;
new expiry is immutable per generation. Originals are outside final-result quota.
Reservations use25MiB pending output; sharing or organizing must not add bytes.

MinIO/AIStor server reports RELEASE.2026-09-19T17-05-25Z. This was a read-only
version inspection, not an IAM or policy test. Existing private bucket is
nxbooth-production. Generic output keys follow results/<id-prefix>/<id>.png;
event outputs have separate results/events/... paths. Keys do not encode account
ownership. NativeObjectStorage.key validates those shapes; changing a folder
name must not rewrite keys. AccountCenter currently lists creations; it has no
folder UI or folder destination. Result IDs and claim tokens are stable.

## Architecture comparison and recommendation

| Choice | Direct S3 isolation | Changes and limitations |
| --- | --- | --- |
| Logical folders + existing private bucket/API authorization | REST and share links only by itself | Smallest first phase; no photo relocation, IAM or bucket changes |
| Same bucket + opaque per-account prefix + per-user IAM identity/scoped application access key | Native S3 List/Get scoped to owner | Recommended S3 direction; requires new key shape, provisioning lifecycle, retention acceptance and historical/guest ownership strategy |
| Separate bucket per account | Bucket scoped IAM | Still shared underlying disks; more bucket/policy/lifecycle administration and a larger change to the single-bucket abstraction; no current requirement justifies it |

Recommendation: implement logical folder management first, then direct S3 as an
explicit second phase. This preserves the owner's direct S3 requirement; phase1
must not be advertised as completing it. IAM identities authorize operations;
buckets hold object namespaces; prefixes partition keys; folders are application
metadata. An IAM user does not create a separate disk or enforce per-user byte
quota. Application generation continues to enforce subscription storage limits.

For S3, recommend one NXBooth-scoped MinIO identity per account when the owner
activates an integration, with a separately rotatable child access key for each
external application. No provisioning at ordinary signup. Parent permissions
must themselves be owner-limited; child policy further restricts to list/read.
Never use the runtime/admin storage credential as a customer integration key.
This identity lifecycle and infrastructure scope require explicit owner review.

## Phase1: concrete user behavior

My Creations opens with All photos, Unfiled, and user-named folders. Signed-in
users can create/rename a flat folder, choose a default generation destination,
and move owned available photos. No nested folders in the initial scope. Names
are plain Unicode text (trimmed,1–80 characters, no control characters), escaped
in the UI; normalized duplicate names in one account return409.

Before generation, the review/capture screen offers a destination select; the
owner's saved default is preselected. No selection means Unfiled. The server
checks ownership when reserving and persists the destination with the job.
Idempotency includes folder selection; changing destination under the same key
returns409. Completion attaches the real result; a failed job creates no photo.
If the folder was removed while processing, completion places the result in
Unfiled. Kiosk/event jobs cannot accept customer folder destinations. Guest
results are Unfiled after account claim, without changing their existing keys.

Moving or renaming is metadata-only. Result ID, object key, paid charge, QR,
expiry and measured quota do not change. Deleting a folder moves its contents
to Unfiled and revokes its folder shares; it does not delete photos. Individual
photo deletion keeps the existing explicit confirmation and retention cleanup.
Default destination becomes Unfiled if its folder is removed.

Folder sharing uses a high-entropy token stored hashed, with explicit creation,
expiry and revocation. Recommended initial mode: current contents (a live
folder), clearly labeled: adding a photo makes it visible to existing share
recipients, moving a photo out removes it. No nested or snapshot shares in MVP.
Owner sees this consequence before creating a link. Shared reads re-check folder
state, token, result ownership, billing, deletion and immutable expiry. Public
share payload exposes only safe result metadata, never email/internal prompts.
Revocation stops new authorization immediately. Already issued signed URLs can
remain usable until their original capped expiry; downloaded copies cannot be
revoked. Bound media links to min(result expiry,share expiry,configured URL TTL).
Do not give a share recipient S3 credentials.

## Proposed additive metadata (not SQL applied)

Use separate tables to avoid replacing existing Prisma result/job mappings:

- photo_folders: id,account_id,name,name_key,created_at,updated_at,deleted_at;
  unique active(account_id,name_key), indexed account listing.
- photo_folder_preferences: account_id PK,default_folder_id nullable. Use owner
  validation and composite constraints where practical to forbid cross-owner refs.
- generation_folder_destinations: job_id PK,account_id,folder_id nullable; created
  in the same transaction as generation reservation; result placement happens in
  completion, with nullable target to handle deleted folders.
- photo_folder_results: result_id PK,account_id,folder_id nullable. One result has
  at most one destination. No membership record means legacy/Unfiled. Lock result
  and folder/account in consistent order when moving/deleting/claiming.
- photo_folder_shares: id,folder_id,account_id,token_hash UNIQUE,expires_at,
  revoked_at,created_at. Never persist or log the plaintext token.

Exact migration number must be reserved after peer coordination (025 is already
used by Public API source). Prepare additive SQL and exercise it on a disposable
DB before asking for production backup/migration approval. No production backfill
is required for phase1: old and claimed guest results appear in Unfiled lazily.
Ambiguous/orphan/kiosk records must never be guessed into an account folder.

## Proposed API contract (not implemented endpoints)

All account operations require an active signed-in account; unknown/cross-owner
folder or result IDs return404. Validation422; duplicate/conflicting request409;
unauthenticated401. Use existing response/error conventions and request limits.

| Method/path | Input / behavior |
| --- | --- |
| GET /api/account/photo-folders | Folder IDs/names/counts, default_folder_id; counts exclude deleted/expired/unpaid results |
| POST /api/account/photo-folders | {name};201 with folder |
| PATCH /api/account/photo-folders/:id | {name};200 |
| DELETE /api/account/photo-folders/:id | Remove folder, unfile photos, revoke shares;204 |
| PUT /api/account/photo-folders/default | {folder_id:string|null};200 |
| GET /api/account/photos | folder_id or unfiled filter, cursor, limit1–50; safe creation metadata and existing delivery URLs |
| PUT /api/account/photos/:resultId/folder | {folder_id:string|null};200; ownership and state checked atomically |
| POST /api/account/photo-folders/:id/shares | {expires_at};201; token only in newly issued share URL |
| GET /api/account/photo-folders/:id/shares | Safe share IDs/expiry/revocation; no token recovery |
| DELETE /api/account/photo-folder-shares/:id | Revoke;204 |
| GET /api/public/photo-folders/:token | Paginated live shared contents, no caching of private tokens/data |
| POST /api/generations | Existing body + optional folder_id for signed-in web requests; immutable request hash covers it |

Public share media authorization should use a share-scoped route; possession of
a result ID alone must not authorize access. Add public/private media paths to
existing analytics/token redaction rules. REST integration folder reads later
reuse these owner-scoped services under separately authorized Public API scopes;
read-only storage credentials never authorize generation or file mutations.

## Phase2: S3 activation and unresolved gates

New authenticated results can use an opaque stable account storage prefix, e.g.
results/tenants/<storage-id>/<result-id>.png. Folder names do not appear in keys;
renaming/moving remains metadata-only. S3 initially represents the whole owner's
space, not selected logical folders. Selected-folder access is provided by share
links/REST until a consistent S3 policy implementation is separately approved.
Default ListBucket is restricted by s3:prefix; GetObject resource is restricted
to that account prefix. No Put/Delete, bucket administration, version listing or
cross-account access. Parent and child permissions must both be tested. IAM and
prefix scopes are logical isolation within shared storage, not physical disks.

Secrets are shown only at issuance; persist safe identifiers/status and a
reconciliation record, never customer secret recovery. Provisioning must be
idempotent/recoverable if MinIO succeeds and SQL fails. Rotation issues a new
scoped key before revoking the old one; revocation failure is reported honestly
and prevents falsely declaring the integration disabled. Suspend/revoke lifecycle
must be exercised on disposable compatible storage before enabling issuance.
The existing app must not receive blanket MinIO admin permission as a shortcut;
scoped provisioning permissions/owner-managed provisioning are a review gate.

Historical and guest-claimed results do not live under account prefixes. Do not
copy them silently or grant broad access to results/*. Options for explicit
review: staged verified relocation updating storage_path while keeping result
IDs/QRs; or new-results-only S3 initially with old results available through web
and authorized REST. Recommended initial S3 scope is new authenticated results
only with a clearly labeled coverage boundary; account activation must disclose it.
No second physical copy is proposed (would complicate quota and deletion).

Direct S3 bypasses Express expiry checks. A prefix-only GetObject grant does not
know subscription_v2_results.expires_at. Current cleanup is asynchronous, so it
cannot by itself promise exact-time S3 denial. Before S3 launch, prove a server-side
expiry-aware policy/authorization strategy on this installed AIStor release, or
obtain an explicit owner decision on a measured cleanup/access-delay bound.
Until then S3 issuance stays disabled. Do not claim ordinary IAM policies or
bucket lifecycle automatically enforce per-result subscription expiry. Endpoint
HTTPS/signing, download range/HEAD, existing object versions and concurrent
revocation also need acceptance; no reverse proxy/IAM changes are authorized here.

## Implementation and acceptance plan

1. Owner approves phase1 metadata/schema and product semantics. Then implement
   model/service/routes + transaction hooks + explicit API callers and My Creations
   UI, without changing object prefixes or IAM. Update API_CONTRACT in that change.
2. Disposable DB tests: two-account isolation, guessed IDs, duplicate names,
   concurrent move/delete/default selection, generate idempotency, folder deleted
   mid-job, guest claim, unpaid/expired/deleted photos hidden, kiosk unaffected,
   share expiry/revocation and preserved QR/expiry/quota/charge.
3. Browser: create/rename/move/default/destination, loading/error/empty states,
   live-share disclosure, revoke, keyboard use and320/390/desktop widths. Confirm
   real backend flows using synthetic fixtures; never customer photo bytes.
4. Produce isolated candidate preserving subscription live state and peer work.
   Production SQL requires reviewed backup+approval; deploy separately approved.
5. S3 is a distinct later acceptance: compatible disposable storage, two tenants,
   root/prefix traversal and write/delete denial, key rotation/revocation,
   exact expiry decision, suspension, failure reconciliation, path compatibility.
   Integration Explorer must describe only endpoints/features actually shipped.

## Evidence and handoff

Read-only inspection commands: git status/log, docker ps, release listing,
agent inbox, source reads, docker exec aistor-server minio --version. No customer
image bytes were read; no test suite is necessary for this documentation-only
proposal. Current state inspected against live subscription release, not merely
older planning assumptions. App/schema/IAM implementation remains pending review.
Only this new proposal document is authored in this continuation; no commit/push.

Official references (consulted2026-10-18; documentation establishes available
policy concepts, not a successful IAM configuration/test on this installation):
- https://docs.min.io/aistor/administration/iam/ — user identities, child access
  keys and policy inheritance/restriction.
- https://docs.min.io/aistor/administration/iam/access/ — ListBucket prefix
  conditions, GetObject resources and supported condition keys.
