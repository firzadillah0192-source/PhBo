# Subscription v2 — implementation and activation handoff

Deployed with owner approval on 2026-10-18. Migration 024 was applied after a
verified production backup. `SUBSCRIPTION_V2_ENABLED=true` in the live API and
worker. The source default remains false for environments without SQL024.
Live release: `/srv/photobooth/releases/subscription-v2-20261018T035402Z`.

## Agreed policy

| Plan | Monthly IDR | AI Credit | Classic Credit | Classic/day | Storage | New-result retention |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Free | 0 | 0 | 500 | 2 | 150 MB | 7 days |
| Starter | 25,000 | 2,500 | 1,250 | 5 | 500 MB | 14 days |
| Plus | 45,000 | 5,000 | 2,750 | 10 | 1 GB | 30 days |
| Pro | 69,000 | 8,000 | 4,250 | 15 | 2 GB | 60 days |
| Max | 99,000 | 12,000 | 6,250 | 20 | 4 GB | 90 days |

Storage units are decimal (1 MB = 1,000,000 bytes). Classic costs 10 Classic
Credit per successful composition. Standard costs 50 AI Credit through 9Router;
Fast costs 100 AI Credit through 9Router using an `openai/` image model and requires an active paid plan. Standard uses a `cx/` model.
Both v2 AI routes use Low quality. No "2x faster" guarantee is advertised.
Max deliberately retains 625 Classic results of credit but a 20/day limit;
only 600 results can be generated in a 30-day window, as approved by the owner.

## Wallet and lifecycle behavior

- Account and guest wallets have separate AI/Classic currencies, each with
  monthly and nonexpiring additional balances. Monthly credit is allocated
  lazily on activity; missed periods never accumulate. Free uses WIB calendar
  months; the existing manual subscription service assigns 30-day periods.
- Owner explicitly approved conversion of old additional credit x10, preserving
  the old Rp100 vs new Rp10 AI Credit purchasing value. Conversion is serialized
  and recorded once; the old wallet is kept for audit. Old free AI allocations
  are replaced by the agreed Free Classic allowance, not converted as paid credit.
- Initial conversion refuses to run while old reservations are unsettled,
  including pending-usage/payment jobs. Drain/reconcile those before activation.
- v2 reserves the fixed price in the matching currency, monthly-first. It is a
  hold until success. Failure returns additional credit and returns monthly
  credit only if its original period is still active. Duplicate settlement does
  not charge/refund twice. Classic daily slots include pending reservations;
  failure releases the slot. Daily accounting uses the request day in WIB.
- Guest-to-account claiming transfers v2 result/job ownership and daily usage;
  signing in does not create a second Free Classic monthly allowance.
- Admin manual assignment/change gives the selected tier a new full period;
  no proration or self-service production upgrade has been implemented.
  Cancellation preserves access until the paid/manual period ends; expiry
  restores Free benefits and preserves additional balances.
- Admin can adjust either currency with audit and idempotency. Deductions take
  from additional balance only; they do not consume monthly benefits silently.
  New v2 ledger entries are available alongside legacy ledger entries.

## Storage and retention

Quota currently counts nondeleted final web results owned by the account/guest,
including existing result files. Kiosk-event objects are excluded. Original
uploads retain the separate existing upload lifetime and are NOT charged to this
new final-result quota. Shared links do not duplicate storage usage.

Before generation, reserve the worker's actual maximum output size (25 MiB) in
addition to existing/pending bytes. This intentionally requires 25 MiB free even
when an average result is smaller. It prevents an expensive AI call from
producing an output with no storage capacity. The reservation is released on
success/failure, and final size replaces it on successful completion.

New results get an immutable expiry snapshot from the tier at reservation.
Reads, signed delivery, printed QR claims, My Creations and cleanup use it. Existing
results without a v2 expiry keep their previous 14-day policy. Downgrades do not
shorten an existing result's promised lifetime. Files were not modified/deleted
in production during preparation or testing.

## Admin route management

Superadmin menu: **Jalur API Generate**. Both lanes use the server-configured
9Router endpoint. Standard (50 credits) uses `cx/gpt-image-2.5`; Fast (100 credits)
uses `openai/gpt-image-2.5-flare` by default (Sunburst is also selectable). Quality
remains Low. OpenAI upstream credentials belong in the 9Router dashboard.

Each lane has independent enablement and model selection. Fast inherits the
Standard saved gateway key, or the server gateway key, unless a new Fast gateway
key is explicitly saved. Legacy Fast direct-OpenAI keys are ignored, never sent
to 9Router. Bare saved Fast model IDs are read with an `openai/` prefix without
rewriting production records. New Fast gateway key overrides use a versioned
prefix in the existing encrypted field; no schema change is required. Clearing
an override restores inherited gateway credentials. Fast defaults disabled.
There is no fallback between the two lanes.

The gateway must forward both reference images to OpenAI's edit endpoint.
See `docs/FAST_9ROUTER_HANDOFF.md` for the prepared gateway patch and validation.
This source update is not deployed yet.

Credentials are encrypted with AES-256-GCM, using a domain-separated HKDF key
derived from the stable server session secret. Keys are never returned to the
browser, included in audit metadata, or logged. Changing the session secret
requires re-entering stored routing keys. "Ready" represents configured/enabled,
not a verified upstream billing or connectivity test. No real provider calls
were made for this implementation. These settings affect customer generation,
not the isolated AI Provider Lab or existing admin preview jobs.

## Checkout and remaining product scope

Checkout supports subscription SKU and AI top-up product snapshots. AI top-up
is Rp10 per credit. Historical payment rows keep their original Rp100/credit;
idempotency rejects changes of product/amount under the same request key.
Migration 024 replaces only the old amount CHECK with explicit legacy/v2 SKU
rules; amount and credit counts cannot be supplied arbitrarily by the browser.

The connected provider is still **Duitku Sandbox only**. A successful simulated
subscription invoice does NOT activate a production subscription or grant
spendable credit. This remains explicit in the customer UI. No recurring debit
or production payment provider is enabled. Admin manual tier assignment is the
available activation path for testing/authorized support actions.

Custom Creation, Classic top-up and Storage + Retention add-ons are displayed as
not available; their implementation/pricing was not finalized. Gift credit is
also future work. Do not advertise those as working paid benefits. Folder/S3
and the integrator Public API are separate inbox tasks, not part of this change.
The customer UI updated here is the production React frontend/ root app; the
experimental frontend-enhanced /v2 experiences are not rewritten by this task.

## API changes

- `GET /api/account/usage` and `/center`: add `subscription` with plan, two
  balances, daily usage, storage and catalog; `api_routes` exposes booleans only.
  Legacy compatibility AI fields remain available. Account center result expiry
  and privacy copy use the actual result/plan policy.
- `POST /api/generations`: optional `lane: standard|fast` for v2 web AI jobs.
  Classic accepts only omitted/standard; native kiosk cannot select a web lane.
  Prices and subscription entitlement are enforced server-side in job creation.
  v2 customer status omits internal provider/model fields; admin telemetry stays.
- `POST /api/account/subscriptions/checkout`: signed-in only; strict body
  `{plan_code: starter|plus|pro|max}` and Idempotency-Key. Server prices the SKU.
- `POST /api/account/topups/checkout`: existing contract, v2 AI unit price only
  when v2 is enabled. History includes `product_kind`, `product_code`,
  `policy_version`; mixed-product Sandbox totals are not presented as one wallet.
- `GET /api/admin/generation-api-routes`: Superadmin only, safe config list.
- `PUT /api/admin/generation-api-routes/:lane`: Superadmin only; strict body
  `{enabled,model,api_key?,clear_key?,confirm:true}`. Blank omitted key preserves
  existing credentials. Both lanes now accept 9Router gateway keys. Fast models must use `openai/` and Standard models `cx/`. Clearing and replacing together is rejected.
- Admin credit adjustment accepts `currency: AI|CLASSIC` with v2; default AI.
  Account credit response adds `subscription` and `v2_entries`. Historical
  account/legacy aggregate counters are not converted into the new ledger.

## Activation runbook (completed for the release above)

1. Check AGENTS, peer inbox, current images/releases and snapshot validation.
   Prepare isolated source/images preserving other agents' dirty work and the
   live worker's existing fixes. Do not deploy this whole dirty workspace.
2. Pause new web generation and drain/reconcile legacy queued/processing and
   pending-usage/payment reservations. Inventory original additional balances.
   Read-only audit found no existing subscription plans/assignments on 2026-10-18.
3. Obtain explicit approval for the concrete production backup + migration 024
   and a separate coordinated deploy action under AGENTS. Verify the backup,
   then manually apply the reviewed forward-only SQL. No Prisma migration/db push.
4. Deploy API and worker with the SAME v2-enabled policy, plus matching frontend.
   Startup verifies required tables/columns read-only. Do not leave old workers
   consuming newly created v2 jobs. Preserve /v2/nginx and keep rollback images.
5. Verify health, default Standard flow, Classic daily/storage limits, account
   balances, admin route status and payment isolation. Fast remains unavailable
   until the owner enters its key directly in Admin Console.

Rollback after real v2 usage is NOT just disabling the flag: legacy wallets are
retained as an audit snapshot and do not track v2 spending. Drain jobs, stop new
mutations and reconcile balances before reverting to legacy accounting, or it
could make already-spent legacy credit available again. Never roll back SQL by
dropping the new wallets/ledger. Obtain owner approval for any live action.

## Validation and files

Test evidence: `/srv/photobooth/tmp/subscription-v2-*.log` and
`test/output/subscription-v2/results.json` plus browser screenshots. Disposable
PostgreSQL tests require `SUBSCRIPTION_TEST_DATABASE_URL` naming database
`nxbooth_subscription_test` and user `subscription_test`; the fixture schema is
destroyed/recreated ONLY inside that guarded disposable database. Never supply
the production database URL. Tests use synthetic accounts/photos/provider
responses and do not prove a real paid API call or live Duitku PAID callback.

Core new files: `subscription-policy.service.ts`, `subscription-wallet.model.ts`,
`generation-api-routes.service.ts`, `generation-api.routes.ts`, SQL 024,
`SubscriptionPlans.jsx`, `GenerationApiRoutes.jsx`, focused unit/integration tests
and `frontend/scripts/subscription-v2-browser-check.mjs`. Existing account,
generation, result, admin, payment, config/container and frontend callers were
updated in place while preserving earlier uncommitted work. No commit requested.

Final validation: backend build and full typecheck PASS; 256 backend tests PASS,
1 existing skip; 111 frontend tests PASS; frontend build PASS (existing chunk-size
warning). Disposable PostgreSQL + real Express HTTP checkout/callback tests PASS
with synthetic gateway, including no production entitlement on Sandbox PAID.
Browser checks PASS at 1440/390/320 for plans, checkout errors, Fast gating and
admin key clearing. Report and copied logs: test/output/subscription-v2/.

Source was frozen and migration-app/container released to Claude for the
separately owner-approved Public API task after this validation. Revalidate the
combined candidate before deployment; these results do not certify later peer
wiring. No commit or deployment was performed by this subscription task.

## Production deployment — 2026-10-18

Owner explicitly requested deployment. Tool: `scripts/deploy_subscription_v2.py`
(`prepare|deploy|status`). API ingress was stopped, legacy jobs drained (zero),
worker stopped, and unsettled legacy reservations checked (zero). Backup:
`/srv/photobooth/backups/pre-subscription-v2-20261018T035402Z.dump`; pg_restore
archive listing verified, hash/size recorded in release manifest. Only SQL024
was applied. SQL025 / Public API wiring and unfinished AI footer changes were
excluded from isolated source snapshots; shared workspace files were preserved.

Images: `photobooth-express:subscription-v2-20261018T035402Z`,
`photobooth-express:subscription-v2-20261018T035402Z-worker`,
`photobooth-web:subscription-v2-20261018T035402Z`. The worker shared service graph
was synchronized with the existing live API baseline plus v2, retaining the live
worker entrypoint/startup behavior. No provider/helper generation modules were
replaced beyond the listed subscription route changes. Both images retain
their original base layers and dependencies.

Release validation: isolated backend compile and 28 focused tests PASS; staged
PostgreSQL + Express HTTP integration PASS; staged browser checks at1440/390/320
PASS; nginx and inherited /v2 fingerprints identical. Live web-port checks PASS:
health, guest Free wallet (0 AI, 500 Classic, 2/day,150MB,7days), full price catalog,
Standard available / Fast unavailable, protected admin/payment paths, frontend
assets, return page and /v2. API/web healthy and worker running with zero restarts.
Express compose snapshot regenerated and validated PASS. Only the three intended
containers changed. Live-verification JSON and test logs are in the release.

No real paid provider generation or new live checkout was performed. Fast still
requires a privately entered key in Admin Console. Duitku remains Sandbox only.
Additional-credit conversion is lazy and one-time when an account accesses v2.
A synthetic guest wallet was initialized by live acceptance; customer accounts
and photos were not used or modified for tests. No commit or push was requested.
Persistent rollback image/compose definitions are retained, but rollback to legacy
accounting requires draining jobs and reconciling any v2 usage, as noted above.

## Standard model correction candidate — 2026-10-18

Owner clarified Standard is the previously working production9Router route with
its existing model; Fast has a separate new direct API key. Read-only audit found
all published admin_experiences (including mini-me) use cx/gpt-image-2.5, while
the newly deployed unsaved Standard default was openai/gpt-image-2.5-flare.
No saved generation_api_routes rows existed at inspection. Source default now
matches cx/gpt-image-2.5; explicit saved overrides remain authoritative. Existing
9Router endpoint/key are reused privately. Fast key/config is independent and
unchanged. This correction does not verify a real paid provider generation.

Focused regression suite:5 PASS; full typecheck PASS. Tool:
`scripts/deploy_generation_route_fix.py prepare|deploy|rollback|status`. Candidate
patches only generation-api-routes.service (TS/compiled JS/map) onto the live API
and worker images; no SQL, frontend or config/key changes. Candidate needs fresh
owner deployment approval; prepared manifests are under generation-route-fix-*.
No commit/push. Folder/S3 follow-up remains proposal-only in
USER_PHOTO_STORAGE_PROPOSAL.md; no IAM/schema/folder implementation was performed.

### Standard correction deployed and verified

Owner approved `deploy` on2026-10-18. Release:
`/srv/photobooth/releases/generation-route-fix-20261018T040419Z`. Live images:
`photobooth-express:generation-route-fix-20261018T040419Z` and
`photobooth-express:generation-route-fix-20261018T040419Z-worker`. Only these two
containers changed; frontend/helper/other projects retained their container IDs.
No SQL, key or environment changes. Compose validated before activation, snapshot
regenerated and validated PASS afterward; API healthy, worker running, zero
restarts. Read-only runtime route service checks in BOTH containers confirm
Standard cx/gpt-image-2.5, ready,50 credits,Low; Fast unconfigured/disabled,100
credits,Low. Health via web port3000 and public HTTPS PASS. Exact source hashes
match the candidate; startup logs clean. No real paid generation was attempted.
Manifest and live-verification.json retain evidence and previous image rollback.
No commit/push; Fast still needs the owner's privately entered new API key.

## Live Classic acceptance — 2026-10-18

Owner requested continuation. Synthetic color cards were uploaded through the
real web API into fresh guest sessions; no customer photos/accounts were used,
no AI calls were made. One first attempt completed but its test expected a
result_id in public metadata (the actual contract omits it); that test assertion
was corrected and its synthetic result deleted. The complete fresh-session run
then PASS:2 real Classic completions at1200x3600,10 Classic Credit each, replay
returns same job/no extra charge, third request429 CLASSIC_DAILY_LIMIT,500→480
Classic balance,0 daily remaining,7-day immutable expiry. Owner and public QR
download bytes match stored SHA256. Storage counted3,956,292 final-result bytes.
Deleting only the synthetic results revoked public access and returned counted
storage to0; spent credit/daily usage stayed spent. Test uploads retain normal
existing upload TTL; no broad storage cleanup was run.

Evidence: test/output/subscription-v2/live-classic-acceptance.json. Temporary
explicit live test runner lives in /srv/photobooth/tmp (not default test scripts).
Fast still has no saved route/key, so no Fast generation acceptance is claimed.
Standard real paid generation and real failure/refund remain untested live;
refund/concurrency accounting passed the prior disposable integration suite.
No code, SQL, IAM, config, deployment, commit or push changes in this continuation.
