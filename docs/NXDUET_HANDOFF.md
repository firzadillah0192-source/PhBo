# NXDuet implementation handoff — 2026-10-24

Status: **PASS for deployment and synthetic end-to-end production acceptance.**
Physical camera/Safari and human likeness quality remain manual acceptance items.
Owner requested commit/deploy on 2026-10-24. Code version `d0176fb` is active as
release `nxduet-20261024T093735Z`; the base feature commit is `32b35c9` and account
contract correction is `f82e0e4`. No push was requested or performed. The existing
untracked `output/` belongs to prior work and was left alone.

## Production release

- API: `photobooth-express:nxduet-20261024T093735Z`.
- Worker: `photobooth-express:nxduet-20261024T093735Z-worker`.
- Web: `photobooth-web:nxduet-20261024T093735Z`.
- Release/manifest: `/srv/photobooth/releases/nxduet-20261024T093735Z/manifest.json`.
- `NXDUET_ENABLED=true` on API/worker via persistent release override. Source default
  stays false. Express snapshot regenerated and validated PASS; all three services
  running, API/web healthy, zero restarts. Image helper, database, Redis, MinIO,
  gateways and co-hosted projects were not replaced.
- Migration 028 applied manually after verified dump. Final preactivation backup:
  `/srv/photobooth/backups/pre-nxduet-20261024T093735Z.dump`, 434092 bytes,
  SHA256 `6671341cdafa5cf35a7bf8d4dbdf0c5add0a21ab33e91ba8c1d8227225ebc405`.
  Initial premigration dump and intermediate backups also remain; manifests record
  the SQL SHA256 and backup verification. No database rollback/schema drop occurred.
- Public URL: `https://nxbooth.gennexbyte.com/nxduet`. Both HTTPS and web port 3000
  return the latest bundle, `enabled:true,preparation_credits:100`, health `ok` and
  401 for unauthenticated template reads.

`node scripts/verify_nxduet_live.mjs --approved-live-acceptance` passed using its own
synthetic account and graphic through the **real** account/upload/API/worker/provider/
wallet/MinIO/composition flow. One 100-credit non-purchased test allocation was held
and consumed once. Same-key retry reused the template; library/image reads worked,
anonymous access was denied, reuse/composition cost zero extra preparation credits,
and a 1300×3000 strip was returned. Actual provider cutout was 1254×1254 with verified
transparency. The template/assets were deleted and its account suspended with sessions
revoked. Evidence: release `acceptance.json`. No customer wallet or image was used.
Rerunning this command creates another synthetic account/test allocation and another
real provider request; it requires explicit live acceptance/deploy authorization.

Two initial activations were rolled back before final success:

1. `092813Z`: real account metadata exposes `analytics_id`, not `id`. Browser library
   binding and acceptance script were corrected; the fixture now mirrors the actual
   response without inventing an `id`. No credits were allocated or AI called.
2. `093317Z`: the application MinIO credential rejected a new top-level `nxduet/`
   prefix. Paths were moved under existing allowed `uploads/` and `results/` roots,
   with a private `nxduet/` subfolder and explicit signed-URL denial. A real write/stat/
   delete storage probe passed. No storage permission was broadened. No preparation
   job/charge was created; the unused synthetic 100-credit allocation was removed.

Both failed-attempt accounts were suspended; their customer sessions were revoked.
Rollbacks restored the previous API/worker/web images, retained additive SQL and left
customer data intact. Corrected release builds recompiled live source and repeated
unit/browser/Compose checks before activation. The only source changes deployed were
the NXDuet patch over each live baseline, preserving unrelated live-only differences.

## Implemented

- Separate `/nxduet` entry, capability-gated link from the creation chooser,
  account sign-in, private template library, empty state and accessible help dialog.
- Upload through existing normalization/ownership checks. Explicit rights statement
  and 100 AI Credit price before submitting preparation.
- One static pose preserving the uploaded subject. Server-owned prompt and model;
  existing provider abstraction with explicit transparent-background PNG options.
  No new provider or service. Opaque/corrupt/empty output is rejected, never passed
  off as a valid companion.
- Auto-save to account after validated output is durably stored. Rename, delete,
  reopen across account sessions and save size/side before the first camera capture.
- Atomic 100-credit hold using the current subscription wallet. Completion consumes;
  failure refunds once to original unexpired allocations. Same-key retries reuse
  one preparation; interrupted workers fail/refund rather than call AI again.
- Live mirrored/cropped camera canvas with overlay, countdown, three captures,
  retake, server composition and direct PNG strip download. Reuse/composition calls
  no AI and incurs no new preparation fee.
- Operator/superadmin listing, account filter, private inspection, enable/disable and
  delete with reason/audit. Existing content managers cannot access user templates.
- Private `uploads/nxduet/<id>/source.jpg` and `results/nxduet/<id>/overlay.png` paths.
  These use existing allowed roots, with no public/signed image delivery. Preparation
  source copies are removed after terminal state; prepared cutouts persist until
  deletion. Existing temporary upload retention continues independently. Template
  storage and pending reservations count toward account storage; consumed charges
  count toward AI usage totals.

## Files

- `backend-express/src/nxduet/{policy,files,model,service,worker,compositor,controller,routes}.ts`.
- Existing migration API/container/server/worker wiring and config; subscription
  wallet aggregate accounting; object-reference validation; provider request options.
- Additive SQL draft `backend/migrations/028_nxduet.sql`. It creates only
  `nxduet_templates` and indexes, with ownership, immutable request fingerprint,
  charge allocation, asset metadata, preparation state and lease fields.
- Frontend `NXDuet.jsx`, `DuetCamera.jsx`, scoped `nxduet.css`, `duetGeometry.js`,
  `DuetPanel.jsx`, route/chooser/admin wiring and centralized `api.js` methods.
- Contracts: `NXDUET_PLAN.md`, `NXDUET_API.md`, API_CONTRACT and MIGRATIONS updates.

## Verification

| Check | Actual result |
| --- | --- |
| Backend `npm run typecheck` | PASS |
| Backend `npm test` | 295 passed, 1 pre-existing skipped test, 0 failed |
| Backend `npm run build` | PASS; Prisma client generation only, no migration |
| Backend `npm run test:nxduet` | 11 passed |
| Backend `npm run test:nxduet-integration` | PASS: real disposable PostgreSQL, HTTP, wallet and disk assets; provider/output are explicit synthetic fixtures |
| Backend `npm run test:nxduet-integration:isolated` | PASS: provisions its own network-disabled test DB, runs the same integration test, stops/removes its container and socket |
| Frontend `npm test` | 130 passed |
| Frontend `npm run build` | PASS; existing duplicate JSX attribute warning in DeveloperWebhooks and large-bundle warning remain outside this scope |
| `node frontend/scripts/nxduet-browser-check.mjs` | PASS with fixture API and Chromium fake camera; lost create response/retry same key, auto-save/reload, overlay pixels, three captures/retake, download, camera-track cleanup, mobile layout and camera-denied state |
| `node scripts/verify_nxduet_provider.mjs` | One real configured-provider request with a synthetic graphic passed RGBA/transparent-pixel validation; output 1254×1254, 573622 bytes |

The provider script keeps live credentials inside the running API, performs one
read-only model lookup and one provider request, and does not write application
jobs/credits or copy any customer photo. It uses a wrapper for the same new request
options without modifying live code. Rerunning consumes another provider request.

Disposable database test environment: PostgreSQL 16 Alpine, no network/host port,
memory/CPU limited, tmpfs data, Unix socket under `/tmp/nxduet-test-1792645031916`.
The test requires both the exact dedicated DB/user and the `/tmp/nxduet-test-` socket
prefix before resetting its schema. Never substitute a production URL.

Use `npm run test:nxduet-integration:isolated` from `backend-express/` to reproduce
without an existing DB: it uses the cached `postgres:16-alpine` image (`--pull never`),
no network, no host ports and tmpfs data. Run the Docker safety inspections required
by AGENTS.md first. Initial manual provisioning attempts failed because PostgreSQL's
bootstrap psql still needed its default socket; the final runner exposes both the
default in-container socket and the isolated test socket. API rate limiting and
browser label/navigation checks also found issues in the initial harness/UI, which
were corrected before the passing runs above. Production rate limits were preserved.

All three manually created test containers (`photobooth-nxduet-test-1792645031916`,
`-v2`, `-v3`) and their socket directory were removed after testing. No networks,
host ports or persistent volumes were added. Final existing web-port health:
`GET http://127.0.0.1:3000/api/health` returned HTTP 200 and `status:ok`. Live
containers retained the image tags listed below, with no NXDuet deployment.

Artifacts (temporary; may disappear on reboot):

- `/tmp/nxduet-browser-check/{create-desktop,camera-desktop,library-mobile}.png`.
- `/tmp/nxduet-browser-check/synthetic-strip.png` is a labelled fixture, not an AI
  portrait or real camera acceptance result.
- `/tmp/nxduet-provider-check/synthetic-cutout.png` is the actual provider cutout of
  the synthetic graphic. Its transparency was measured and visually inspected.

The integration test covers double-submit, conflicting replay, insufficient
credits, storage quota, mixed monthly/top-up holds/refunds, expired-period refunds,
one terminal settlement under race, interrupted/queued recovery, source cleanup,
private image access and cross-account denial, composition without further AI,
admin restrictions/audit, disable/enable/delete, and replay after deletion. Unit tests
also verify private MinIO namespace behavior and ambiguous-completion preservation.

## Remaining manual acceptance and rollback

1. Test a consented human source photo for likeness, edge quality and useful pose.
   A synthetic graphic's alpha test does not establish portrait quality.
2. Exercise a physical phone/booth camera, including Safari. Fake Chromium media
   verifies the browser flow, not physical camera quality or hardware compatibility.
3. Rollback command (owner approval required):
   `python3 -I scripts/deploy_nxduet.py rollback`. It stops ingress, drains normal and
   NXDuet work, restores previous API/worker/web tags and flag, then regenerates and
   validates the snapshot. It retains schema and settled wallet changes. Do not restore
   the old database dump over new customer activity or drop the new table. Old images
   do not display NXDuet usage/storage aggregates while rolled back, although balances
   stay in the same wallet. Reactivation must reconcile any retained templates/jobs.
4. New deployments continue to require explicit approval, persistent overrides,
   snapshot validation and a rollback. Use `scripts/deploy_nxduet.py prepare|deploy`;
   the script applies only SQL028 after a verified backup and preserves the live
   source of each container. `status` reads the current manifest.

Operational boundaries: preparing a template can take provider time; no instant-time
promise. The first version has one pose and no tracking/animation/occlusion. Strips
download directly and are not added to the existing result/QR/folder library.
Admin changes to active preparation wait until terminal state. Already delivered
image bytes cannot be recalled from a browser. Normal account storage limits apply
to saved cutouts, independent of temporary result-retention periods.

Predeployment rollback baseline (retained images):

- API: `photobooth-express:fast-prompt-20261022T042623Z`.
- Worker/helper: matching `-worker` and `-helper` tags.
- Web: `photobooth-web:processing-meter-20261022T040303Z`.
