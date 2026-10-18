# Inbox — Per-user photo folders, sharing and read-only integration

Status: REQUESTED / PLANNING ONLY. Created 2026-10-18 for a separate future
Codex task. Do not implement or deploy merely because this document exists.
Owner will start the task from its inbox. This work is separate from the
subscription/checkout redesign discussed in the originating conversation.

## Owner's request

NXBooth users should manage their generated photos through named folders in the
website. Users choose a destination folder before generating, name folders
themselves, and can organize existing results. Each user has a private storage
space isolated from other users. Owner proposed automatically provisioning a
MinIO IAM user for every application user, with separate storage rather than an
undifferentiated shared space. Evaluate that proposal explicitly; do not quietly
replace it with a different architecture or provision IAM users yet.

Users should be able to share a folder/storage link, and external applications
should be able to list and retrieve authorized photos using a read-only API.
External consumers must not upload, generate, overwrite, move, or delete files.
The signed-in owner still needs normal management through NXBooth itself.
Owner clarification: external applications need direct S3-compatible access to
MinIO over an internet-accessible endpoint, not only a custom NXBooth REST API.
Plan per-user identities/scoped S3 credentials with tenant-limited list/read
policies. Provisioning every signup versus provisioning on integration activation
is still a lifecycle decision. A REST-only design does not satisfy this request.
Publishing an endpoint does not mean making all photos anonymously readable.
Maintain separate share-link/QR access for recipients without S3 credentials.
Official starting references (checked 2026-10-18):
https://docs.min.io/aistor/administration/iam/
https://docs.min.io/aistor/administration/iam/access/
"Public" means accessible through a shared link/QR from the internet, not an
automatically indexed public gallery or an anonymously writable MinIO bucket.

## First deliverable for the future agent

Related future task: docs/PUBLIC_API_INBOX.md. Owner expanded the platform to
external photobooth/developer integrations with template-based generation and
a documentation/API Explorer page. Keep S3 credentials read-only; generation
uses a separately scoped NXBooth API key and validated input-upload flow. The
earlier prohibition on external generation applies to read-only storage
credentials, not to explicitly authorized public generation API requests.

Inspect current source and deployed behavior, then produce a concrete proposal
for owner review: user flows, storage/IAM alternatives, ownership model, API
contracts, retention/quota behavior, migration strategy and acceptance tests.
Do not start the implementation until significant architecture/schema/IAM
decisions have been reviewed under AGENTS.md. Do not start parallel agents.

Compare at least:

1. Existing private bucket with per-user object prefixes, logical folder metadata
   and application authorization for management/read-only integrations.
2. Per-user IAM identities or scoped credentials/policies on the existing bucket.
3. Separate buckets per user, if actual operational constraints justify it.

The comparison must preserve the clarified direct S3 requirement. Option 1 alone
is insufficient unless it includes S3-native authorization for external clients.

Distinguish logical tenant isolation from physical storage separation. Explain
what IAM identity, bucket, object prefix and application folder each control;
verify capabilities against the installed MinIO/AIStor version and official
documentation before recommending an option. Recommend the smallest fit, with
credential lifecycle, policy scope, quota enforcement, revocation, operational
cost and backwards compatibility made explicit. Never hand out server admin or
application storage credentials to clients.

## Expected product behavior to specify

- My Creations folder view with custom names, default destination, per-generation
  selection and moving existing results; scope nested folders as a decision.
- Renaming/moving a folder must preserve result IDs and existing claim/QR links.
  Evaluate metadata-only moves before proposing object copying or renaming.
- Authenticated users see only their own folders, results and storage usage.
  Preserve guest, account-claim, kiosk/event ownership and admin behavior.
- Folder sharing: unguessable token, owner revocation, optional expiry, explicit
  choice between current folder contents and a snapshot. Decide what happens to
  newly added/moved images, deleted folders and nested folders.
- External API: separate scoped read-only credential, selected folder or owner
  scope, list/pagination/filter and image retrieval; expiry/rotation/revocation,
  rate limiting and appropriate CORS. Avoid access tokens in ordinary URLs/logs.
- Direct S3: specify endpoint, bucket/prefix, region/signing compatibility and
  securely issued access-key/secret pairs. Scope ListBucket to the user's prefix
  and GetObject to allowed objects; prove no cross-tenant listing/reading or write
  operations. Do not expose secrets in public browser bundles. Quota/retention
  changes and folder moves must remain consistent with S3-native authorization.
- Metadata control can be handled by the API with short-lived authorized media
  delivery. Assess existing signed URLs rather than making the bucket public.
- A revoked share must block new authorization immediately; explain any remaining
  validity of already issued signed URLs and already downloaded copies.
- Retention/deletion always limits access, including shared links and API access.
  Sharing or moving does not duplicate quota or restart retention automatically.
- File deletion is owner-authorized, not exposed through external read-only
  credentials. Define empty/non-empty folder deletion and recovery semantics.
- Existing photos need an additive ownership/folder backfill proposal. Do not
  move or inspect customer photo bytes during planning. Identify ambiguous
  ownership and orphaned data without exposing customer details.

## Related subscription planning, not implemented

Storage proposal: Free 150 MB / Starter 500 MB / Plus 1 GB / Pro 2 GB / Max 4 GB.
Retention proposal: 7 / 14 / 30 / 60 / 90 days respectively. Add-ons may extend
storage and retention. Keep folder ownership independent of subscription tier;
coordinate quota/retention interfaces rather than implementing billing here.
Define which bytes count: final output, originals, renditions, thumbnails, trash.
The previous conversation has not finalized all those quota semantics.

Metadata audit on 2026-10-18 used MinIO HEAD only for 31 active completed results:
Classic 14 samples, mean 4.11 MB; Basic 13, mean 3.10 MB; Advanced 4, mean 8.31 MB.
These are small mixed-resolution samples, not guaranteed file-size ceilings.

## Starting points and current constraints

- Read AGENTS.md, skills/backend-express/SKILL.md, skills/frontend-react/SKILL.md
  as applicable, backend-express/MIGRATION.md and CUTOVER.md.
- Check git status/log, live containers, release directories and agent inbox.
  Existing dirty files belong to ongoing work; preserve them.
- Inspect frontend AccountCenter/My Creations and backend account/result models,
  services and routes. Relevant files include:
  backend-express/src/services/customer-account.service.ts,
  backend-express/src/services/customer-result.service.ts,
  backend-express/src/services/native-object-storage.service.ts,
  backend-express/prisma/schema.prisma and frontend/src/components/customer/.
- Existing results use result IDs and minio://results/... references; delivery
  supports signed media URLs and claims/QR. The storage-reference validator
  currently permits specific key shapes. Prefix changes need a compatibility
  plan rather than silently rewriting keys.
- MinIO is the pre-existing aistor-server and bucket nxbooth-production. AGENTS
  restricts changes to shared infrastructure; do not modify its container, IAM,
  bucket policies or other projects without explicit scoped owner approval.
- Production schema changes require additive SQL, explicit approval and backup;
  no prisma migrate/db push. Every deploy requires separate explicit approval.
- No secrets, photo bytes or private customer paths in planning outputs.

## Acceptance criteria for a later implementation proposal

Cover two-account isolation, guessed IDs/prefixes, read-only token write denial,
share revocation and expiry, quota full, retention deletion, folder rename/move,
concurrent creation, ownership migration, guest/kiosk compatibility and existing
QR continuity. Identify tests needing disposable DB/storage, never production.

## Handoff

This task created only this planning inbox document and a dormant Codex task.
No application, database, MinIO IAM/policy, photo object, subscription or live
deployment changes are authorized by this handoff. No commit was requested.
