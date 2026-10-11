# Frontend v2: integration and additive deployment

The Figma export is `origin/frontend-enhance` at `68bcdaf`. Its customer, admin
and kiosk applications are imported into `frontend-enhanced/`. The live entries
use `LiveCreate`, `LiveResult`, `LiveAccount`, `LiveAdmin`, `LiveCatalog` and
`LiveKiosk`. They render the Figma layouts and components with real API data;
the original prototype screens (mock data) remain as export reference only.
The customer `/design-system` and `/screens` reference routes are not routed
in production builds. The Figma `Claim.tsx` kiosk-session flow has no production
backend (the production claim is the result QR claim) and is not implemented.

## Routes

| Purpose | Route |
| --- | --- |
| Existing customer, admin and kiosk | Existing URLs, unchanged |
| V2 customer | `/v2/`, `/v2/app/*` |
| V2 admin | `/v2/admin/`, `/v2/admin/login`, `/v2/admin/overview`, etc. |
| V2 kiosk | `/v2/kiosk/`, `/v2/kiosk/kiosk` |
| V2 shared photo | `/v2/r/:token`, `/v2/claim/:code` |

Every application has its own Vite asset base and React Router basename.
Customer and admin reuse `frontend/src/api.js`; staff kiosk reuses
`frontend/src/kioskWebApi.js`. All requests use `/api`, existing cookies,
existing production contracts, existing idempotency and existing analytics
sanitization. No backend or schema changes are needed. This is a second UI
against the same data, not a separate database or test environment.

Customer upload/camera, published catalogs, Classic 1–4 photos and event
personalization, Basic/Advanced generation, polling, results, download, real
QR, photo deletion, password/Google authentication, account history, credits,
profile, sessions and retention policy use existing API responses. Account
draft restoration stores upload references and selections in sessionStorage.
It stores no photo bytes or credentials. Payment remains unavailable at the
existing server boundary; no frontend action grants credits or simulates payment.

Admin authentication/role checks use `/api/admin/me` and are enforced again by
the backend. Operational panels use paginated backend reads. Account status,
session revocation, credits, subscription assignments, catalog CRUD/assets,
preview generation/publishing and share/result deletion use actual mutations.
Admin-only prompts, models and provider data remain inside the staff application.
Staff kiosk uses `/api/kiosk/access` and the Google-authorized kiosk session;
query parameters cannot bypass authentication or fabricate a result.

The backend's canonical share/printed QR URL remains `/r/:token`, so phones
opening those links still see the current main Result UI. The v2 shared route
also resolves the same claim. No token contract or printed QR is changed.

## Local validation

```sh
cd frontend-enhanced
npm ci
npm run typecheck
npm test
npm run build
node scripts/browser-check.mjs
```

The browser suite serves built bundles on an ephemeral localhost port and
intercepts every API call with isolated fixtures. It exercises Classic four
photos/personalization, real browser camera capture with a fake test camera,
Basic/Advanced payloads, queued/processing/completed/failed states, QR,
delete, login failure/success, profile save, role filtering, kiosk gating/flow,
mobile overflow and unavailable public claims. It does not touch production
data or call the AI provider. Fixture screenshots are under
`/tmp/nxbooth-v2-ui-check/`; they are not generated customer results.
Set `PHBO_V2_CHROMIUM` to an installed Chromium path when needed.

Live Google sign-in, physical camera/HEIC behavior and actual provider output
remain acceptance checks after an approved deploy. Browser fixtures prove UI
contracts and state handling, not provider availability or output quality.

## Deployment

Routing test: `python3 -m unittest scripts.test_deploy_frontend_v2` from the repo root
(not `python3 -I`). Use `scripts/deploy_frontend_v2.py`, never plain Compose from the repo:

```sh
python3 -I scripts/deploy_frontend_v2.py prepare
# Obtain explicit approval for this prepared release before running:
python3 -I scripts/deploy_frontend_v2.py deploy
python3 -I scripts/deploy_frontend_v2.py status
# Separately authorised rollback if needed:
python3 -I scripts/deploy_frontend_v2.py rollback
```

Preparation records the source and rollback in a persistent
`/srv/photobooth/releases/frontend-v2-*/` directory, typechecks/tests/builds the
three bundles, patches only the live web image and validates nginx and Compose.
The old HTML checksum is verified against the inherited image. Public Google
and PostHog build configuration is reused from the current runtime without
printing secrets. The script refuses deployment if the web image changed since
preparation. API/worker/storage/ports and the host proxy are untouched.

Deploy recreates only `photobooth-web`; there can be a brief web restart, while
backend jobs keep running. Verify container health/no restart loop, old HTML,
the main URL, all v2 deep links, `/api/health` and unchanged other container IDs.
Switching v2 to the main URL is a later, separately requested release.

## Handoff: 11 October 2026 (design parity pass)

Source of truth: `origin/frontend-enhance@68bcdaf` (74 files, all imported). The first
prepared releases (`frontend-v2-20261011T044814Z`, `...T045227Z`, `...T045711Z`) predate
this pass: **run `deploy_frontend_v2.py prepare` again** before any deploy; do not deploy
the older images. Nothing from v2 is deployed; the web still runs
`photobooth-web:kiosk-printer-20261010T130035Z`. Nothing is committed.

Changed in this pass (all under `frontend-enhanced/`, no backend or schema change):

- Kiosk: `LiveKiosk` now renders the Figma stage (1080 × 1920 canvas, header with step
  progress, attract collage, mode rows, style gallery, processing, result + QR, idle
  dialog) using exports from `Kiosk.tsx`. Real camera with a 3-2-1 countdown or file
  upload, real catalog, polling and result claim. Idle reset is 20 s on the result
  screen and 90 s elsewhere, then a 15 s countdown. Classic picks the layout before the
  photos (it decides the shot count); Basic/Advanced take the photo first, as designed.
- Customer: Figma upload dropzone and "Photo ready" row, subtitles, frame-style radio
  cards, numbered Classic photo rows, review summary rows and credit card, Figma
  Processing/failed states, Result (mode badge, aspect ratios, share/delete sheets,
  toasts), shared-photo page, sign-in/up copy, account tabs, creations chips, credits,
  profile, sessions and privacy rows. `usePhotoInput` in `shared/PhotoInput.tsx` holds
  the camera/upload logic; `customer/src/components/live.tsx` is the Figma dropzone.
- Admin: Figma `DataTable`, `FilterBar`, `Tabs`, `Timeline`, `SimpleBarChart`,
  `ImageAssetPanel`, `ConfirmDialog` (reason + confirmation, replacing `window.prompt`)
  and modal forms on top of the existing admin API: login, overview, generations and
  detail, users and detail, credits ledger, usage and detail, providers, audit,
  subscriptions, settings, plans, admin users, experiences and editor, templates,
  Classic layouts, presets, preview source. `InlineSelect` no longer stretches to full
  width. Credit adjustment keeps its idempotency key across a lost response.
- Admin sections the API has no data for (system status card, mock timelines) are omitted
  rather than invented.

Validation: typecheck of the three apps, 5 shared unit tests, 2 nginx routing tests,
production builds and 26 browser assertions (isolated fixtures) pass. Screenshots are
in `/tmp/nxbooth-v2-ui-check/`. Still open: visual comparison against the Figma frames
side by side, physical camera/Google/provider acceptance, and the deploy itself.
Express snapshot validation still reports `image differs` (pre-existing, unrelated).
