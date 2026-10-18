# Storage API — implementation handoff, 2026-10-18

Status: DEPLOYED, LIVE ACCEPTANCE PASS. Owner explicitly approved backup, SQL025, private .env configuration and deployment on 2026-10-18. No commit was requested or made. Other agents’ dirty files were preserved.

Candidate: `/srv/photobooth/releases/storage-api-20261018T100917Z/manifest.json`.
Images: `photobooth-express:storage-api-20261018T100917Z`, `photobooth-web:storage-api-20261018T100917Z`.
Production API/web now use `storage-api-20261018T100917Z`; worker remains `photobooth-express:photo-folders-20261018T084345Z-worker`, helper remains its floral-event image. Other projects unchanged. API/web healthy, 0 restarts; worker running, 0 restarts.

Implemented:
- Account tab `developer`, labeled API & Integrasi, and public `/developers` docs/Explorer.
- Cookie-authenticated key list/create/rotate/revoke, owner isolation, one-time full secret, HMAC-only DB storage, expiry, scopes, atomic 10-active-key limit and atomic replacement/grace update. Rotation preserves old key for at most 24h, limited by earlier original expiry. In-flight requests that authenticated before revocation may finish; subsequent authentication rejects the key.
- Bearer-authenticated folder/photo lists and image/download reads. Storage has no mutations. Existing ownership, payment, expiry and quota policies remain authoritative. Returned media URLs still require the Bearer header.
- Public capabilities and OpenAPI 3.1 spec. Private APIs unmounted without pepper. Startup only checks schema; it does not migrate it.
- Explorer only calls fixed same-origin GET destinations, omits cookies, rejects redirects, no automatic authenticated request, no secret persistence/telemetry, masked input, clear action, abort on unmount. Full keys cleared when dialogs close.
- Public upload/generation require PUBLIC_API_GENERATION_ENABLED=true; default/candidate false. Existing website generation remains active. Native S3 IAM is not implemented by this release. Fast provider key is a separate unfinished configuration.

Touched implementation files:
`backend-express/src/{config/migration-env.ts,migration-app.ts,migration-container.ts}` and existing Public API model/service/routes, new `routes/storage-openapi.ts`; frontend App/customerRoute/api/AccountCenter plus new DeveloperApi component/CSS/tests/browser runner; .env.example and API_CONTRACT. Deployment preparation patches wiring into live migration-server.ts inside candidate. It copies only Public API files plus wiring onto the live source baseline, preserving unrelated Lab/AI-footer/desktop changes outside this release.

Validation:
- Backend typecheck, tests (278 PASS, 1 pre-existing MinIO integration skip), build PASS.
- Frontend tests 116 PASS; build PASS, existing bundle-size advisory.
- SQL025 applied twice to disposable PostgreSQL: hash/authentication, tenant isolation, rotation/revocation, usage, pagination and 15 concurrent create requests capped at 10 PASS.
- Disposable PostgreSQL + HTTP folder/Storage integration: real key authentication, scope denial, folder/photo ownership, download, photo expiry (404), revoked key (401), write denial, existing quotas/retention/hooks PASS.
- Candidate source compiled and Public API route suite passed in prepare.log. Both disposable integration tests rerun against candidate source PASS.
- Browser checks on workspace AND candidate at 1440/390/320 widths: issue once, close clears secret, rotation, revocation, explicit Explorer request, 401, clear, inactive service, no overflow and no page errors PASS. Browser uses clearly synthetic mocked responses, not a real AI generation.
- Evidence `/opt/photobooth/test/output/storage-api*`, `output/public-api-*-tests.log`, candidate prepare.log. Live compose snapshot validate PASS; no production writes or deploys performed.

Approved activation procedure (completed; retained for handoff):
1. Check mailbox, deployments in flight and Docker/resource preflight; snapshot validate PASS.
2. `python3 -I scripts/deploy_storage_api.py deploy --configure-private-pepper` only if owner explicitly approved private `.env` configuration. Otherwise set PUBLIC_API_KEY_PEPPER privately (>=32 chars), then `deploy` without the opt-in flag. Keep this pepper stable across releases; do not paste/log it. The opt-in generates 32 random bytes privately and adds the hex value to .env (0600), with a private pre-change env backup. This is an explicit exception to the repo default of editing only .env.example and requires owner approval.
3. Script verifies unchanged live IDs/config/mounts, prepares a verified pg_dump backup, manually applies frozen SQL025 with ON_ERROR_STOP, updates only API/web through persistent Compose, checks health/capabilities and regenerates/validates Express snapshot. Rollback overrides preserve previous API/web images. SQL025 remains additive if rolled back.
4. Inspect logs/restart counts, 401 protected endpoints, write routes 404, API Explorer through web port, and a real synthetic signed-in account → issue key → own folder/photo read → revoke denial. Do not read customer photos or call AI/payment. Record live acceptance separately before claiming deployment complete.

Do not rerun deploy on this already deployed candidate. For future changes prepare a new release and obtain fresh deploy approval. SQL025 and the private pepper are active.


## Production activation and acceptance

- Verified backup: `/srv/photobooth/backups/pre-storage-api-20261018T100917Z.dump` (archive listing and SHA256 recorded in manifest). Private pre-change .env backup is in backups with mode0600; do not print it.
- `python3 -I scripts/deploy_storage_api.py deploy --configure-private-pepper` PASS. SQL025 applied manually by the deploy script after verified backup. Pepper generated privately in .env (0600), never printed. Only API/web containers recreated. Worker/helper/MinIO/other projects untouched.
- `docker compose ... config --quiet`, compose ps, dependency health and Express snapshot generate/validate PASS. API/web 0 restarts; logs checked with no errors.
- HTTPS `/developers`, capabilities and OpenAPI all 200; capabilities report enabled=true, storage=true, generation=false. Protected APIs 401; gated upload/generation 404.
- Live acceptance through web port3000: new marked synthetic accounts, actual cookie key management, scoped Bearer requests, another account denied, usage metadata, rotation/grace and revocation PASS.
- Actual Classic worker composed three synthetic PNG cards, persisted output to MinIO and the default folder; API Storage and owner downloads matched metadata SHA256. No AI/payment request. Result and folder subsequently deleted through owner endpoints; all test API keys revoked and sessions logged out. Test accounts retained for audit; uploads follow ordinary TTL.
- Actual compiled deployed web + real API (no mocks) PASS at1440/390: key manager, create/one-time secret dismissal, Explorer authenticated folder request, clear action, no overflow/page errors.
- Evidence: release `live-acceptance.json`, `live-verification.json`; screenshots `/opt/photobooth/test/output/storage-api-live/`. Acceptance runner `output/storage-api-live-acceptance.mjs` contains no credentials/secrets.
- All work remains uncommitted. Public API generation, direct native S3 IAM and Fast provider configuration remain separate unfinished stages; this release completes read-only Storage access.
