# NXBooth admin — Express compatibility and retro UI

Production: https://nxbooth.gennexbyte.com/admin

Status: **PASS — deployed and verified**.

Release: `photobooth-web:admin-20261007T073102Z`.
Snapshot: `/srv/photobooth/releases/admin-20261007T073102Z/frontend`.

## Requested change

Bring the admin console into line with the existing Express backend and the current NXBooth retro interface. Express already serves the native admin endpoints; this release changes the frontend only.

## Changes

- Cream paper, ink outlines, colored metric cards, consistent NXBooth branding and navigation groups across all 13 sections.
- Mobile navigation drawer with Escape, focus management, background interaction prevention, selection close, and clear links back to NXBooth.
- Fixed section navigation that previously rendered a blank page after Subscriptions → Generations: effects no longer return loading promises as cleanup functions. Section rendering failures are contained and can be retried.
- Refresh clears the in-memory admin read cache and reloads the current section. Admin data and credentials are not persisted by that cache; startup authentication remains a live request.
- Credits, subscriptions, audit, and settings display failed requests explicitly instead of presenting fake empty results or permanent loading.
- Restored the missing session-revocation API import and visible initial user-detail errors.
- Provider operations include Basic and Advanced AI jobs. Generation results, usage, credit state, estimates, and private result links follow native Express responses. Missing provider metadata remains unknown.
- Plan creation uses POST. Editing uses PATCH with only the seven writable fields accepted by Express, excluding immutable ID/code and server timestamps. No payment integration or subscription allocation rules changed.

## Main files

- `frontend/src/AdminPage.jsx`
- `frontend/src/api.js`, `adminReadCache.js`, `adminPlanPayload.js`, `pricingDisplay.js`
- `frontend/src/components/admin/AdminShell.jsx`, `AdminResultPhoto.jsx`, `result-photo.css`
- `frontend/src/admin-retro.css`, `frontend/src/main.jsx`
- `frontend/scripts/admin-retro-browser-check.mjs`
- `scripts/deploy_admin_frontend.py`

## Validation

- Initial authenticated read audit: all 18 inspected native Express admin endpoints returned 200. Response shapes were recorded without dumping customer records or credentials.
- Isolated production snapshot: `npm test` — **72 passed**, zero failures; `npm run build` — PASS.
- Browser checks: **58 passed locally and on the final live release**, including 13 menus at widths 1440, 820, 390 and 320; actual Express reads, generation detail, active navigation, mobile Escape/focus behavior, no document overflow or runtime errors. Failed reads and Refresh recovery are exercised. Plan create/edit uses mocked writes and tests strict payload keys, including DTOs with server timestamps.
- Real live UI authentication: login, Subscriptions → Generations, user detail/back, logout and reload — PASS; no business mutations.
- Customer credit regression: 16 guest/account × Basic/Advanced × empty/race × desktop/mobile cases passed on the first admin release; App source hash remains identical to the credit release in the final snapshot. API generation/signup requests were mocked.
- Compose validation passed before startup. Only `photobooth-web` was recreated; existing backend, worker, database, Redis and other project container IDs were preserved.
- Final web container healthy. Real `/api/health`: database, Redis, storage, queue and connected provider all healthy.

Commands:

```sh
python3 scripts/deploy_admin_frontend.py prepare
python3 scripts/deploy_admin_frontend.py deploy
ADMIN_UI_BASE=https://nxbooth.gennexbyte.com ADMIN_CHECK_OUTPUT=/opt/photobooth/test/output/admin-20261007T073102Z node frontend/scripts/admin-retro-browser-check.mjs
NXBOOTH_PREVIEW_URL=https://nxbooth.gennexbyte.com NXBOOTH_CREDIT_OUTPUT=/tmp/nxbooth-admin-credit-regression node frontend/scripts/credit-gate-browser-check.mjs
curl -sS https://nxbooth.gennexbyte.com/api/health
```

Browser screenshots remain in ignored local test output. The script uses a temporary authenticated API session and logs it out; business writes to production are blocked. Production plan, user, credit and catalog mutations were not exercised; this validation deliberately uses fixtures for writes.

## Rollback

The final release manifest and `compose.rollback.yml` are under `/srv/photobooth/releases/admin-20261007T073102Z`. Backup image: `photobooth-web:before-admin-20261007T073102Z` (previous admin release). The earlier credit-only image and snapshot also remain available. `python3 scripts/deploy_admin_frontend.py rollback` restores the manifest's previous frontend without recreating other services; recheck health and the live UI afterward.
