# Credit wallet and checkout release — 2026-10-09

The AI usage limitation described below was subsequently resolved for aggregate counters by `docs/TOKEN_ESTIMATE_DEPLOYMENT.md`. This document records the earlier rollout.

Deployment PASS. Actual AI token billing PARTIAL because 9Router does not report the required token categories. Payment gateway integration remains intentionally unavailable.

Release directory: `/srv/photobooth/releases/credit-checkout-20261009T021554Z`.

## Shipped behavior

- 50 free credits for signed-in accounts, reset to 50 every 14 days; free credits used first, additional balance preserved separately.
- Photo Booth / Scene Remix / Creative Studio names, searchable same-window mode pickers, credit refill popup, fixed/custom Bekal choices.
- AI requires at least 10 credits to start; Photo Booth costs 1 credit per completed result. No deduction on starting or failed generation.
- Bayar requests a server checkout. Gateway unavailable/network failure opens a same-window notice with `mailto:support@gennexbyte.com`. A valid future server checkout URL continues to payment; no fake success or client credit grant.
- Existing kiosk rules are preserved separately: its generation allowance and Classic unlimited behavior are unchanged. Deployment review caught this interaction; `reserveKioskIn` retains the live accounting path.

## Actual limitation

One real 9Router validation request returned a valid image and aggregate input/output/total token counters, without text/image/cache categories. This cannot determine the agreed actual price. The deployment charges no estimated AI rate: new AI results remain `PENDING_USAGE`, inaccessible until complete usage is available. Additional AI generation for that owner is blocked while pending; Photo Booth remains available. No real validation image was inserted into customer generation records or presented as a customer result. Connecting verified payment settlement and complete provider usage remains necessary.

## Isolation and rollback

Sources were copied from active web/API/worker releases and only selected credit/checkout files were overlaid. Existing kiosk routes, helper, gateways, Google sign-in configuration, MinIO delivery settings, and unrelated projects were retained.

Changed containers only:

- `photobooth-web`: `photobooth-web:credit-checkout-20261009T021554Z`
- `photobooth-express`: `photobooth-express:credit-checkout-api-20261009T021554Z`
- `photobooth-express-worker`: `photobooth-express:credit-checkout-worker-20261009T021554Z`

Only migration `backend/migrations/021_credit_wallets.sql` was applied in one transaction. No generation jobs were queued/processing at cutover. No database/Redis ports were published, and no reverse proxy, image helper, network, volume, or other project's container was changed. Network remains `photobooth-net`; web uses existing port 3000, API remains internal.

Database backup: `/srv/photobooth/backups/pre-credit-checkout-20261009T021554Z.dump` (mode 0600, archive list verified). Images/Compose rollback recorded in release `manifest.json` and `compose.rollback.yml`. `python3 scripts/deploy_credit_checkout.py rollback` returns to prior images; it does not drop wallet tables. A code rollback alone is inappropriate after new charge records exist, because prior code cannot protect pending results or maintain wallet accounting. In that case, block new generation and reconcile billing before rollback; never discard customer charges or restore over new activity casually.

## Verification

- Active-release frontend: 84 unit tests PASS; production build PASS.
- API and worker production sources: TypeScript compile PASS.
- Staged actual Express contract / PostgreSQL wallet and worker-result integration: 4 tests PASS. Covers reset, concurrent/idempotent settlement, after-result price, protected unknown usage, checkout 503 and auth/validation errors.
- Staged real kiosk regression: PASS, including AI allowance, Classic unlimited, claim and download access.
- 14 staged browser scenarios PASS at 1440/390/320px with actual disposable account/wallet API and synthetic catalog fixtures.
- 6 live HTTPS browser scenarios PASS at `https://nxbooth.gennexbyte.com`: actual signup grants 50/14-day wallet, actual checkout 503 and support popup, desktop/mobile custom selection preserved and balance unchanged, all three real catalog pickers/search/Escape.
- Public and local `/api/health`: `status=ok`, database/Redis/storage/queue all `ok`. API/web healthy; worker started normally. No startup errors observed.
- Existing co-hosted container IDs unchanged; roughly 109 GiB disk and 7.4 GiB available memory observed before deployment.
- Temporary production verification account, its session, wallet, and signup ledger were removed. Disposable test PostgreSQL and preview API were stopped/removed. Zero real payment transactions and zero production customer image generations in verification; one isolated real provider response for usage validation.

Evidence: release `live-verification.json`, `provider-usage-validation.json`, build/test logs and live desktop/mobile screenshots. Local implementation notes: `docs/CREDIT_WALLET_TOPUP.md`. Broad test-source typechecking still has the pre-existing typing issues documented there; production source compilation passes.
