# NXDuet implementation handoff — 2026-10-24

Status: **PASS for local implementation; PARTIAL for production acceptance.**
No commit, push, production SQL application, image build/deploy, or live feature
activation was performed. `NXDUET_ENABLED=false` remains the default. The existing
untracked `output/` belongs to prior work and was left alone.

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
- Separate private `nxduet/<id>/source.jpg|overlay.png` object namespace. Preparation
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

## Remaining acceptance and activation

1. Test a consented human source photo for likeness, edge quality and useful pose.
   A synthetic graphic's alpha test does not establish portrait quality.
2. Exercise a physical phone/booth camera, including Safari. Fake Chromium media
   verifies the browser flow, not physical camera quality or hardware compatibility.
3. Before production, review migration 028 and back up production. Apply SQL only
   with explicit owner approval. No Prisma migrate/db push/startup schema mutation.
4. Prepare a separately reviewed deployment script using the repository deployment
   pattern and persistent release overrides; validate the Express snapshot and keep
   rollback. Deployment itself needs explicit owner approval. Set feature flag only
   when API and worker agree, then perform real web-port acceptance and health checks.

Operational boundaries: preparing a template can take provider time; no instant-time
promise. The first version has one pose and no tracking/animation/occlusion. Strips
download directly and are not added to the existing result/QR/folder library.
Admin changes to active preparation wait until terminal state. Already delivered
image bytes cannot be recalled from a browser. Normal account storage limits apply
to saved cutouts, independent of temporary result-retention periods.

Live stack observed, unchanged by NXDuet:

- API: `photobooth-express:fast-prompt-20261022T042623Z`.
- Worker/helper: matching `-worker` and `-helper` tags.
- Web: `photobooth-web:processing-meter-20261022T040303Z`.
