# Developer dashboard + generation history — 2026-10-18

Status: DEPLOYED — PASS. Owner explicitly requested deploy on 2026-10-18. API/web deployed with release164029Z; no schema, pricing or secret changes. No commit requested; implementation remains uncommitted. Paid AI acceptance belongs to owner.

Final candidate: `/srv/photobooth/releases/developer-dashboard-20261018T164029Z/manifest.json`.
Images: `photobooth-express:developer-dashboard-20261018T164029Z`, `photobooth-web:developer-dashboard-20261018T164029Z`.
Baseline API generation-api-20261018T151805Z and web customer-ui-20261018T163804Z. Earlier dashboard163816Z candidate is SUPERSEDED due to the peer CSS release. Worker/helper remain unchanged.

Implemented:
- Account → API & Integrasi dashboard: current AI/Classic balance and storage, plan/account period, period7/30/90 and key filters, daily/request/job counts and actual spent/reserved/refunded AI credits. Per-key table includes revoked keys (newest50); zero-filled daily data. Counts of requests/validation/retries are distinguished from unique jobs and actual charges.
- API generation history with state/key/period filters, newest-first cursor navigation, safe error/status/charge fields and download only for paid, live, nondeleted results. No provider/model/prompt/storage path/secret exposure.
- Original API key attributed once via existing generation_events metadata in the same DB transaction as new job/reservation/idempotency creation. Cross-key retry on the same account reuses job and preserves original attribution. No schema or billing/provider change. Old jobs are not retrospectively attributed; UI explains history begins at activation.
- Cookie-owner-only dashboard/history routes under /api/account/api-keys. Foreign-key filter404, missing auth401, invalid selector422. Existing rate limiter/no-store remain. Dashboard is optional unless Public API+subscription wallet are available; capabilities indicates availability.
- Preserves peer UI/i18n/CSS releases. Requested key badge data-status attribute added; peer CSS renders status colors. DeveloperDashboard uses existing useT for ID/EN, explicit Jakarta dates. No custom API budgets/webhooks/new modes in this scope.

Files:
- New backend models/developer-dashboard.model.ts and services/developer-dashboard.service.ts, test/developer-dashboard.test.ts.
- Shared model/service generation changes only for internal integration context and transactional event; generation-request type, public-api route, key-management route, migration app/container wiring, package test list and existing Public API/folder integration tests.
- New frontend DeveloperDashboard.jsx and browser runner; DeveloperApi renders dashboard based on capability, refreshes after key changes, adds data-status. API helpers, CSS and contract tests updated.
- scripts/prepare_developer_dashboard.py, deploy_developer_dashboard.py; docs/API_CONTRACT.md.
- Shared working-tree AI footer/Lab/desktop changes are not deployed by this candidate. Prepare copies current live source and patches only integration attribution/wiring into model/service/container; it does not copy unreleased footer implementation. No commit by this task.

Validation PASS:
- Workspace backend typecheck,284 tests PASS/1 existing MinIO skip, build. Frontend122 tests PASS, build (existing bundle-size advisory).
- New service/route tests: WIB boundary, zero-fill, attempt vs unique-job credit accounting, account/key/cursor validation, cookie/Bearer separation, safe DTO and paid/expired link gating.
- Real disposable PostgreSQL+HTTP integration PASS on workspace AND candidate: reserve50, same-key and cross-key idempotency, one original-key marker, failed queue refund50, other account denied, revoked key history retained, per-key totals. Explicit metadata fixtures verify consumed/refunded totals, deleted/expired results and cursor paging. No real AI output is claimed.
- First SQL test caught reserved alias day syntax; fixed with quoted alias, rerun PASS.
- Candidate TypeScript build + Public API18/dashboard4 tests and frontend build PASS (prepare.log).
- Candidate browser1440/390/320 inside full AccountCenter + customerLayout styles PASS: balances/statistics, key/day tables, status/key/date filtering, next/back, download availability, empty/error and no page errors/overflow. Browser API responses are marked mocks.
- Production snapshot validate PASS; no production schema/credit/secret/container changes. Existing event indexes (job_id, event_type, created_at) reused.

Evidence: candidate prepare.log/manifest; `/opt/photobooth/output/developer-dashboard-*-tests.log`, `/opt/photobooth/test/output/developer-dashboard-candidate/` screenshots/browser-results.json. Disposable test DB container removed at completion.

Deployment procedure (completed with owner approval):
1. Check mailbox/release slot, Docker/resource preflight, live IDs and snapshot validate. Peer has been deploying UI/CSS; reject/reprepare on any intervening release.
2. `python3 -I scripts/deploy_developer_dashboard.py deploy` deploys API/web only. No SQL, .env write, new secret or worker/helper deploy. Persistent rollback restores previous API/web; stored API event metadata is retained safely.
3. Verify compose ps, logs, restart counts, dependency health, HTTPS/port3000, capabilities dashboard=true. Regenerate/validate snapshot (script does it).
4. Non-paid live smoke may create a marked synthetic free account/key, dashboard empty/zero balances, scope/owner denial and frontend states. Do not grant production credit, use customer photos or call paid AI. Actual per-key attribution requires a successfully reserved new API job; its path is proven in disposable DB, real AI tests belong to owner.


Live acceptance PASS: cookie-only API auth, free wallet, 7/30/90-day data, empty history, invalid filters422 and unknown-key404, real deployed Account UI1440/390/320 without mocks/overflow/page errors, public HTTPS docs/capabilities. API/web healthy with restart0; worker/helper unchanged; logs no error lines; snapshot regenerated and validated PASS. Initial synthetic cleanup hit management rate limit429; scoped transactional cleanup revoked its one key and removed its one auth session, retaining marked account for audit. Evidence: test/output/developer-dashboard-live/acceptance.json and screenshots; release/live-acceptance.json. Existing events only attribute new jobs after activation; paid AI was not run.
