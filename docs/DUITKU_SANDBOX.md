# Duitku Sandbox checkout preparation — 2026-10-17

Scope authorized by owner: prepare Sandbox checkout, payment transaction SQL, and
Admin Console inspection. Production migration, application deployment, real
billing, and production credit grants are not authorized by this preparation.

## Behavior

- Existing Rp100/credit catalog is retained: 100/Rp10,000, 200/Rp20,000,
  300/Rp30,000, 500/Rp50,000, 1,000/Rp100,000. Legacy custom selection supports
  integer amounts 1–100,000 credits, enforced by the server.
- Customer checkout creates a durable `payment_transactions` row before the
  provider call. `(account_id, request_key)` and merchant order IDs are unique.
  Clients reuse `Idempotency-Key` for retries of the same selection.
- Invoice creation is leased for 30 seconds. Gateway uncertainty leaves the same
  order recoverable (`CREATING`/`INVOICE_UNCONFIRMED`); selection never grants credit.
- Only fixed HTTPS Duitku Sandbox endpoints are callable. Returned hosted checkout
  links must use `https://app-sandbox.duitku.com/redirect_checkout` and the returned
  reference. No embedded vendor script or new dependency is required.
- Form-urlencoded callbacks validate merchant, amount, order, reference and
  timing-safe HMAC-SHA256 signature. Callback `resultCode` is not covered by the
  signature, so authenticated transaction-status verification determines settlement.
- Repeated/concurrent success is one atomic PAID transition. Later failure/pending
  cannot undo PAID. Verified late success can settle an expired/canceled order.
- Sandbox balance is the sum of PAID transaction credits, credited once per row.
  **No code writes production wallets, quota counters or credit_ledger.** Sandbox
  credits cannot generate real photos and Sandbox amounts are not revenue.
- A return redirect never settles a payment. The static `/payment-return.html`
  page loads the owned order through the authenticated API, then offers an explicit
  verification button. Query `resultCode` and `reference` are not payment proof.
- No cron or periodic calls hit Duitku's status endpoint. Manual/callback checks
  share a 30-second per-order DB lease/cooldown; UI handles HTTP 429.
- Operator/superadmin can inspect Payments, search by merchant order/reference/
  customer email, filter status, paginate, inspect timestamps and retry status
  verification. Content managers and customer sessions cannot access this API.
  Admin checks are recorded in existing `admin_audit_log`; there is no manual
  mark-paid or credit-grant control in Payments.

## Configuration and credentials

Owner enters credentials privately in `/opt/photobooth/.env`; it is gitignored.
Never show the file, echo credentials, copy it into build contexts, or place Duitku
keys in `VITE_*` variables. `.env.example` documents names only:

```dotenv
DUITKU_ENABLED=false
DUITKU_ENVIRONMENT=sandbox
DUITKU_MERCHANT_CODE=
DUITKU_API_KEY=
DUITKU_PUBLIC_ORIGIN=https://nxbooth.gennexbyte.com
```

Enabled mode requires both credentials and an HTTPS origin. Production mode is
intentionally rejected by the config schema and SQL constraint. Existing Compose
snapshots use an explicit environment: adding keys to `.env` alone does not inject
these keys into running containers. The prepared persistent API override adds
only the five Duitku variables (secret values remain `${...}` placeholders).
Worker, helper and AI provider configuration are not changed.

Project website: `https://nxbooth.gennexbyte.com`.
Callback: `https://nxbooth.gennexbyte.com/api/payments/duitku/callback`.
Invoice return URL: `https://nxbooth.gennexbyte.com/payment-return.html?order_id=<id>`.
This replaces the earlier suggested `/account/credits` return address, which does
not exist in the currently deployed legacy client. The provider receives the
correct return URL on each invoice request.

## Schema and source

Migration: `backend/migrations/023_duitku_sandbox_payments.sql`, additive and
idempotent. Stores references, amounts, status, timestamps, leases, request keys
and sanitized error codes only. Does not store API keys, signatures, callback
bodies, customer card data, or raw provider responses. Customer email is joined
from the existing account table for authorized admin reads.

Core files:
- `backend-express/src/models/payment.model.ts`
- `backend-express/src/services/duitku-sandbox.service.ts`
- `backend-express/src/services/payment.service.ts`
- `backend-express/src/routes/payment.routes.ts`
- Existing migration app/container, account and admin routing/configuration wiring.
- `frontend/src/components/admin/PaymentsPanel.jsx` and AdminShell/AdminPage menu.
- Existing `CreditTopUp.jsx`, new `PaymentHistory.jsx`, `SandboxTopUp.jsx`, API client.
- Static `frontend/public/payment-return.{html,css,js}` and matching enhanced copies.
- Enhanced customer `LiveAccount.tsx`: payment-only replacement of unavailable form.

Existing unrelated modifications from other agents are retained. Do not commit
whole dirty shared files without separating ownership. Nothing was committed.

## Preparation and rollout

`python3 -I scripts/prepare_duitku_sandbox.py prepare`:
1. Validates the persistent Express snapshot against live containers.
2. Copies current API sources and the legacy frontend source snapshot matching
   live HTML, applying payment-only patches. New payment files are added.
3. Compiles the staged API and runs its 12 focused payment/API tests; builds the
   staged frontend with the existing public Google/PostHog configuration.
4. Builds API/web candidate images FROM their currently running images. The web
   image retains inherited `/v2`, old hashed assets and nginx configuration.
   Enhanced customer source changes are prepared in the repo but are not shipped
   over inherited `/v2` assets, which have unrelated in-flight source changes.
5. Writes persistent Compose/rollback definitions, SQL copy and manifest under
   `/srv/photobooth/releases/duitku-sandbox-prepared-*/`. Resolved credentials are
   never written into the release. **It never deploys or executes SQL.**

`python3 -I scripts/prepare_duitku_sandbox.py status` reports the current candidate.

Before activation, obtain separate owner approval for backup, application of SQL
023, and deployment of the candidate API/web. Recheck agent mailbox, live images,
resources and snapshot; if live/source changed, prepare/review a fresh candidate.
Use the recorded previous images and persistent snapshot/web-base/rollback
Compose files for rollback. Retain the additive transaction table; never restore
an old database over new account activity. Disable new checkouts if rolling back.
After deployment validate snapshot (regenerate after Express changes), Compose
status, API/web/helper logs and health, real request via port 3000, public HTTPS
callback accessibility, and a complete real Duitku Sandbox payment.

## Validation evidence and remaining acceptance

Automated gateway tests use a marked HTTP transport double, synthetic merchant
key and customer email. No real Duitku API request was made in preparation; real
credential validity and external callback delivery remain unverified until the
approved Sandbox activation. The owner does not need to send credentials in chat.

Commands:
- `cd backend-express && npm test` (includes 12 focused payment tests)
- `cd backend-express && npm run typecheck && npm run build`
- `TEST_DATABASE_URL=<guarded disposable URL> node --import tsx --test test/duitku-payment.integration.ts`
- `cd frontend && npm test && npm run build`
- `cd frontend && node scripts/duitku-sandbox-browser-check.mjs`
- `cd frontend-enhanced/customer && npm run typecheck && npm run build`
- `python3 -I scripts/snapshot_express_compose.py validate`

Integration test hard-requires database `nxbooth_express_duitku_test` and Unix socket
`/tmp/nxbooth-duitku-postgres-test-socket`; it creates its own minimal fixtures and
applies SQL 023 twice, then tests real concurrent SQL, isolation, audit and guards.
Test PostgreSQL uses a network-disabled `photobooth-duitku-sandbox-test-20261017`
container, no published port, no production DB or customer images.

Browser evidence: `test/output/duitku-sandbox/` at widths 1440/390/320; verifies
same-key checkout retry, hosted redirect, return query not proof, status check,
admin detail/check/filter, responsive overflow and no page exceptions. Browser
API responses are test doubles; this is not a live Duitku acceptance claim.

Duitku merchant verification still requires correct product/pricing/support
content on the domain registered with Duitku. Support phone/address and primary
versus subdomain registration remain owner inputs; preparation does not modify
`gennexbyte-*` services or claim all verification requirements are complete.

## Official protocol references

- https://docs.duitku.com/pop/id/ — createInvoice, HMAC-SHA256 headers, callback,
  window redirection and sandbox hosted checkout.
- https://docs.duitku.com/api/id/ — transactionStatus HMAC-SHA256, signed amount
  verification, response codes and warning against repeated automatic checks.

Docs checked 2026-10-17. No MD5 fallback, no disabled TLS verification.

## Prepared candidate and final results

Release: `/srv/photobooth/releases/duitku-sandbox-prepared-20261017T083010Z`.
Candidate images (not live):
- `photobooth-express:duitku-sandbox-20261017T083010Z`
- `photobooth-web:duitku-sandbox-20261017T083010Z`

Previous/live images remain:
- `photobooth-express:ai-lab-20261014T072016Z`
- `photobooth-web:desktop-login-20261014T044733Z`

PASS preparation: backend suite 236 passed/0 failed/1 storage test skipped;
14 focused payment+checkout tests passed; guarded disposable PostgreSQL integration
passed; frontend 111 tests passed; backend typecheck/build, both frontend builds,
enhanced typecheck and 1440/390/320 browser checks passed. Staged live-source API
compile and its 12 payment tests passed. Compose configuration and persistent
Express snapshot validate PASS. Candidate web `/v2` and nginx hashes match live.
The temporary test PostgreSQL container and its anonymous volume were removed.

Evidence: release `manifest.json`, `validation.json`, `prepare.log`, `validation/`
logs/screenshots, SQL copy and persistent Compose/rollback files. Live API/web
container IDs are unchanged. No production SQL, live payment call, deployment,
commit or push. Real Sandbox payment and external callback acceptance remain
PARTIAL until owner-approved backup/migration/activation and testing.

## Authorized deployment — 2026-10-17

Owner explicitly approved deployment. A fresh candidate was prepared on the latest
provider-payload API and activation-page web images, preserving those fixes.
Live release: `/srv/photobooth/releases/duitku-sandbox-prepared-20261017T134035Z`.
Live images:
- API: `photobooth-express:duitku-sandbox-20261017T134035Z-transport1`
- Web: `photobooth-web:duitku-sandbox-20261017T134035Z`

Verified metadata backup:
`/srv/photobooth/backups/pre-duitku-sandbox-20261017T134233Z.dump` (0600, pg_restore
archive listing validated), then SQL023 applied with ON_ERROR_STOP in one transaction.
Persistent Compose/rollback and pre-deployment Express snapshot are in the release.
Deployment tool: `python3 -I scripts/deploy_duitku_sandbox.py deploy|rollback|status`.
The `repair-transport` action handles the corrective patch discovered during live
acceptance, without reapplying SQL. No commits or pushes were made.

Live acceptance found two issues and fixed them before handoff:
1. One advertised Duitku DNS address did not respond from the VPS. Payment HTTP
   now tries at most two live DNS answers, five seconds each within a 12-second
   total deadline, with hostname/SNI and TLS certificate verification preserved.
   No hard-coded IP, system DNS, firewall or network configuration change.
2. For POP, status uses `https://api-sandbox.duitku.com/api/merchant/transactionStatus`
   as implemented in the official PHP library's Pop::transactionStatus; current
   HMAC-SHA256 authentication is retained. Before a method is submitted, the exact
   provider error `Transaction not found` (400 plain text or 404 JSON) remains a
   pending method selection, never a paid transaction. This supersedes the earlier
   legacy status endpoint discussed in preparation notes.

PASS deployment: API/web healthy, zero restarts; web-port health and public HTTPS
Admin Payments/detail/return page pass. Actual Sandbox invoice Rp10,000 and BCA VA
were created; authenticated real-provider status query returned PENDING with the
correct amount/reference. Invalid callback signatures are rejected through public
HTTPS. Production wallet unchanged. Worker/helper/other projects unchanged;
inherited /v2/nginx and the existing provider fixes verified byte-for-byte intact.
Express snapshot regenerated and validate PASS. Backend suite: 245 passed, zero
failed, one storage integration skipped. Focused payment/checkout: 17 passed.

PARTIAL payment-success acceptance: the official VA simulator presents Cloudflare
human verification. Owner was asked to simulate BCA VA 7007014001695120, Rp10,000
(simulation only, no actual transfer). Latest checked test order remains PENDING;
no paid callback or sandbox balance grant is claimed. Test order ID:
36939be56c6c72dea7de31bd3f0808fc. The synthetic account is suspended, its temporary
operator role deactivated and all its sessions revoked; transaction/audit remain
for owner inspection. Callback can still reconcile the test order after simulation.
Private generated test credentials were removed after revocation.

Evidence: release `manifest.json`, `live-verification.json`, `preservation.json`,
`migration.log`, `transport-repair.log`, and `validation/` logs/screenshots.
Official references additionally checked from the owner's links:
https://docs.duitku.com/payment-gateway/overview/
https://docs.duitku.com/payment-gateway/api-browser/
https://github.com/duitkupg/duitku-php/blob/master/Duitku/Pop.php

## Customer Billing tab follow-up — 2026-10-18 (deployed)

Owner reported Billing was empty. Cause: AccountCenter's BillingTab still used
its pre-gateway static placeholder; payment history had only been mounted in
Tambah Bekal. The fix replaces that placeholder with the account's actual
PaymentHistory, Sandbox state and link back to top-up. PaymentHistory now shows
loading, explicit API failure/retry, empty state and manual reload, with the
existing account panel spacing. Disabled billing explains availability without
requesting history. This changes no backend endpoints, database or payment state.

Changed UI files: `frontend/src/components/customer/AccountCenter.jsx` and
`frontend/src/components/customer/PaymentHistory.jsx`. Regression browser test:
`frontend/scripts/billing-history-browser-check.mjs`. Deployment tool:
`python3 -I scripts/deploy_billing_history.py prepare|deploy|rollback|status`.
Owner explicitly approved deployment on 2026-10-18. The release layers only
those two files over the previously live
frontend source/image, preserves nginx and inherited /v2, and records rollback
under `/srv/photobooth/releases/billing-history-*/manifest.json`.

Validation: 111 frontend tests pass; build passes. Real AccountCenter component
browser checks at 1440/390/320 pass pending and paid rendering, manual status
check, failure/retry, empty account, disabled billing and no horizontal overflow.
Tests use synthetic API fixtures, do not grant credits, and do not claim live
paid callback acceptance. Candidate source build/browser checks and image
preservation are recorded with the release. No commit.

Deployed image: `photobooth-web:billing-history-20261018T014153Z`.
Release: `/srv/photobooth/releases/billing-history-20261018T014153Z`.
Activation and health checks PASS; web is healthy with zero restarts. Only
photobooth-web was recreated; nginx and inherited /v2 assets were preserved.
Real public HTTPS frontend browser checks PASS at 1440/390/320, including
pending/manual check/paid rendering, failure/retry, empty and disabled states.
These UI checks use synthetic API responses; they do not prove a live paid
callback. Evidence is in `live-browser-evidence/results.json` and screenshots.
Production API health through web port reports database, Redis, storage and
queue OK. Backend, worker, schema and payment balances were unchanged.
Rollback: `python3 -I scripts/deploy_billing_history.py rollback` (requires
owner approval for a new deployment action).
