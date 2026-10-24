# Generation API implementation handoff — 2026-10-18

Status: DEPLOYED, NON-PAID LIVE ACCEPTANCE PASS. Owner explicitly authorized deploy on2026-10-18. No commit requested/made. API/web now run generation-api-20261018T151805Z with generation=true. During this task Claude deployed customer-ui-20261018T151341Z web and committed c9571ef; candidate captures that current live web baseline. No commit by this task.

Final candidate: `/srv/photobooth/releases/generation-api-20261018T151805Z/manifest.json`.
API image `photobooth-express:generation-api-20261018T151805Z`; web image `photobooth-web:generation-api-20261018T151805Z`. Worker/helper unchanged. Two earlier preparation directories (151556Z/151722Z) are marked SUPERSEDED; never deploy those.

Scope:
- BASIC template generation through the current Standard production service, 50 AI Credit, same real wallet/storage/retention and reservation/refund rules. No new provider, billing policy, schema, secret or public Fast/custom-prompt/ADVANCED support.
- API upload201 → generate202 (Idempotency-Key required) → status QUEUED/PROCESSING/COMPLETED/FAILED → download with existing Storage API and Bearer key. Caller must inspect state; 202 is not completed output.
- Template credit_cost uses approved Standard policy constant. Public generation schema accepts template_id, input_id and optional folder_id only. Unsupported model/lane/prompt/event_name/captured_at rejected422; those personalization fields are not supported for BASIC by the current production baseline.
- Existing API key UI adds opt-in generation scopes when capability is enabled. Old keys (including rotated replacements) keep existing scopes; create a new key to add permission. No automatic privilege upgrade.
- Generation Explorer requires explicit credit consent and deliberate template/upload/generate/status/download actions. No automatic paid requests. A network error keeps request key and body frozen for identical retry; definite validation/auth rejection permits reset. Terminal retry responses can be queried again for missing result/refund details. Credentials remain masked and memory-only; no cookies, URL secrets, persistence, redirects or telemetry.
- OpenAPI generation operations/capabilities appear only when PUBLIC_API_GENERATION_ENABLED=true. Startup requires subscription v2 if generation enabled. Read-only Storage behavior remains available.

Files changed for this task:
- backend-express/src/routes/public-api.routes.ts, routes/storage-openapi.ts, migration-app.ts, migration-container.ts.
- backend-express/test/public-api.test.ts, photo-folder.integration.ts.
- frontend/src/api.js (new helper appended), components/customer/DeveloperApi.jsx, new GenerationApiExplorer.jsx, developerApi.css, developerApi.test.js, scripts/generation-api-browser-check.mjs.
- scripts/prepare_generation_api.py, deploy_generation_api.py; docs/API_CONTRACT.md and this handoff.

Coordination: Claude reported uncommitted customer UI/i18n work. It was acknowledged and preserved. The customer UI was then deployed by Claude; mailbox notification arrived15:21. App/AccountCenter/StudioModal/main/layout/i18n were not edited by this task. Candidate starts from deployed API and customer-ui-20261018T151341Z web source, overlays only the four backend and four integration frontend files, and preserves the now-live UI redesign while excluding unreleased event-name/AI footer work. All other frontend source files were verified byte-for-byte against the live customer-ui release. Do not replace workspace wholesale with candidate source.

Validation PASS:
- Workspace backend typecheck, test suite280 passed/1 pre-existing MinIO skip, build. Frontend121 tests and build passed; existing bundle-size advisory.
- Candidate backend TypeScript build and Public API18-test suite passed; web build passed.
- Disposable PostgreSQL+HTTP test against workspace and candidate: actual job/model/wallet reserve50; identical retry returns same job with one queue enqueue; changed body409; queue failure sets FAILED and refunds50; status owner isolation404; no model/provider internals. Fixture registry/upload/queue stubs explicitly marked; credits seeded only in disposable DB. No production DB changes or paid AI call.
- Candidate browser at1440/390/320: key-scope opt-in, local valid synthetic PNG preview, explicit cost consent, upload, same key/body retry after network abort, terminal-response status lookup, download gating, FAILED/refund display, clear and no overflow/page errors. API responses are clearly mocked and do not establish real provider image quality.
- Storage regression fixture was updated to include ai_remaining for the new live homepage; the initial incomplete fixture caused a browser error, not a production API error. Rerun results at1440/390/320 are recorded separately in test/output/generation-api-storage-regression.
- Preparation snapshot validate PASS. Subsequent owner-approved deployment changed only API/web and generation feature flag; no SQL, production balance grant or .env changes.

Evidence: candidate prepare.log and manifest; `/opt/photobooth/output/generation-api-*-tests.log`; `/opt/photobooth/test/output/generation-api-candidate/browser-results.json` and screenshots. Disposable DB container is removed after tests; no customer/test photos touched.

Approved activation procedure (completed; retained for handoff):
1. Check peer mailbox/release slot and Docker preflight. `python3 -I scripts/snapshot_express_compose.py validate` must PASS. Reject stale candidate if live IDs changed.
2. `python3 -I scripts/deploy_generation_api.py deploy` changes only API/web images and sets PUBLIC_API_GENERATION_ENABLED=true. No SQL or .env write. Existing private pepper and all other env/mounts verified unchanged. Persistent rollback override restores Storage-only release/flag.
3. Script checks compose config/health/capabilities, regenerates and validates snapshot; inspect logs/restarts and real request via port3000/HTTPS afterwards.
4. Live non-paid smoke: a marked synthetic free account/key may upload synthetic image and verify insufficient-credit denial plus no job/charge. Real successful AI provider generation still needs an account with legitimate AI Credit and a consented photo. Do not grant production credit, transfer money, reuse customer images or claim provider output based on mocked tests. Existing website Standard pipeline is preserved, but no new live provider acceptance has run in this task.


## Production deployment and smoke acceptance

- `python3 -I scripts/deploy_generation_api.py deploy` PASS after owner said deploy. Only photobooth-express and photobooth-web recreated, both generation-api-20261018T151805Z. Worker remains photo-folders-20261018T084345Z-worker, helper remains floral-event-20261010T073959Z. Other projects unchanged.
- Existing stable private pepper/mounts/env preserved; only PUBLIC_API_GENERATION_ENABLED set true. No SQL or .env changes. Persistent rollback restores API storage-api and web customer-ui baseline with generation=false.
- Compose config/ps, health, logs/restart checks and snapshot generate/validate PASS. API/web healthy, all four checked containers running with0 restarts.
- HTTPS /developers and capabilities/OpenAPI 200. Generation capability true; OpenAPI POST operations present.
- Actual deployed web + API at1440/390 (no mocks): generate-scope key creation, one-time secret display/dismissal, live template50-credit quote, synthetic valid PNG preview/upload through private image helper into MinIO, explicit credit acknowledgment, insufficient-credit rejection, clear action and no page errors/overflow PASS.
- Cookie-free Bearer upload works; Storage-only key denied403 for upload/generate; missing key401; required idempotency header400 and unsupported Fast422 PASS.
- Synthetic free account had0 AI Credit before/after. A real API request was rejected for insufficient AI Credit before queue/provider; storage used/reserved remained0 and no generated result was created. No production credit grant, real AI call, customer photo or payment used.
- All synthetic keys revoked (generation key then401), session logged out. Marked test account retained for audit; one synthetic input follows ordinary upload TTL. No customer photos touched.
- Evidence in release live-acceptance.json/live-verification.json and `/opt/photobooth/test/output/generation-api-live/`; runner `output/generation-api-live-acceptance.mjs` holds no credentials.
- Limitation: actual paid AI image generation via the public endpoint remains untested. DB reserve/refund/idempotency and browser lifecycle tests passed before deploy; they do not establish real provider output. No commit by this task; peer UI commitc9571ef preserved.


## Git checkpoint requested 2026-10-18

The owner requested a commit after deployment. The checkpoint records the scoped Generation/Storage API plus its previously deployed, uncommitted subscription/wallet/folder/Sandbox-payment prerequisites. Mixed files use the released content for these features, preserving unrelated working-tree AI-footer/Lab/desktop edits. No new production change or push is part of this checkpoint.

A clean review tree was assembled from HEAD plus the selected content: backend application build PASS, default backend suite243 PASS/1 existing MinIO skip, frontend build PASS, frontend API/routing/privacy18 tests PASS. Full frontend tests still contain a pre-existing photoManagement English-vs-Indonesian fixture failure from the UI commit. Full backend typecheck also sees the pre-existing HEAD Lab test referring to registerModels absent in HEAD LabService; the unrelated uncommitted Lab implementation/test fixes were deliberately excluded. These are inherited baseline limitations, not claims that all clean-tree checks pass. The deployed candidate and full shared-worktree validations are recorded above separately.
