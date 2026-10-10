# Web photo management and 14-day retention

Status: PASS — deployed after the owner explicitly approved deleting existing expired photos. All 26 web photos older than 14 days were removed from storage, marked deleted, and their claims revoked. No expired web results remain pending cleanup at verification.

## Changes

- `AccountCenter.jsx`: accessible same-window StudioModal for deletion, cancel/Back/Close/Escape, errors with retry, visible 44px delete control, and per-photo expiration date.
- `CreditTopUp.jsx` / `retro.css`: matching bordered paper summary and payment note above Bayar, popup theme variables, custom credit helper and mobile spacing.
- `CustomerResultService` / `CustomerResultModel`: deletion requires ownership but does not require payment completion. Unsettled reservations are released; already consumed credits are preserved. Storage removal must succeed before marking the database deleted and revoking claims.
- `result-retention.ts`: web results expire 14 days after result creation. Owner endpoints, public claims, and new signed delivery URLs respect that deadline. Kiosk result retention is excluded using the persisted kiosk session association.
- `CustomerAccountService` / `CustomerAccountModel`: expiration dates and 14-day privacy policy; deleted photos omitted from the archive.
- `migration-worker.ts`: cleanup deletes expired web results in batches of 100 during the existing maintenance cycle. Physical cleanup follows the upload cleanup interval (default one hour); endpoint expiry takes effect at the deadline.

The active policy applies the creation-date rule to existing results as well as new results. The owner chose immediate deletion of already expired photos; no migration grace period applies.

## Verification

- Workspace frontend unit suite: 94 passed. Active-release frontend suite: 93 passed; production TypeScript builds for both API and worker passed.
- PostgreSQL integration: 2 passed in dedicated disposable `nxbooth_credit_test`, including owner/foreign-owner HTTP DELETE, mandatory confirmation, deletion of unpaid result, no charge/refund of spent balance, disappearance after reload, ability to generate again, expiry on owner/public routes, physical removal, claim revocation, and idempotent cleanup.
- Focused storage/signed delivery/retention tests: 13 passed, 1 environment-dependent real MinIO test skipped. Boundary, kiosk exclusion, signed URL/claim expiry ceiling and storage failure safety covered.
- Browser deletion/checkout: 1440px, 390px, 320px passed; cancellation, Escape, errors/retry/success, date label, tap size, payment popup, preserved custom amount, retro note styles and no horizontal overflow.
- Payment regression: 6 standalone/nested viewport scenarios passed, including gateway unavailable/network/auth, successful checkout URL routing, validation and keyboard focus. No real payment was processed.
- Active-release sources are patched only with this task's diffs; both API/worker production TypeScript builds, staged frontend suite/build and Docker Compose config validated. No other application resources changed.

## Release preparation

`python3 scripts/deploy_photo_management.py prepare` builds isolated images and rollback configuration from current running sources. Latest release path: `/tmp/photobooth-photo-management-release-path`.

`deploy` refuses to proceed if any running web/API/worker image changed since preparation. Once the historical-photo policy is settled, rebuild if needed and verify before using the deploy action. Only the dedicated photobooth web/API/worker containers should change.

No schema migration is needed for the currently prepared creation-date policy. Do not run a rollback database restore over subsequent customer activity; images can be rolled back independently.

## Production verification

Release: `/srv/photobooth/releases/photo-management-20261009T033339Z`. Executed `python3 scripts/deploy_photo_management.py deploy` and `status`; Compose configuration passed. Only `photobooth-web`, `photobooth-express`, and `photobooth-express-worker` changed. Web/API health checks passed; worker started without errors. Public `/api/health` reports database, Redis, storage and queue healthy. Public JS/CSS bytes match the staged build.

Verified all 26 expired photo files are unreadable, no active claims remain, and owner access is rejected. Cleanup retry returned zero deletions; SQL reports zero remaining expired undeleted web results. Historical metadata remains for auditing. Rollback restores previous images but cannot restore deleted photo files.
