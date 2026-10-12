# Old customer frontend viewport fixes

Status: PASS for deployment, fixture viewport acceptance and read-only live
catalog acceptance. Final correction deployed with owner approval on 12 October
2026 at 09:16 UTC / 16:16 WIB. Physical Safari/hardware validation remains open.
Owner requested commit/push after deployment. Only task-owned paths are included.
Publication uses an isolated checkout of `origin/main` because local `main` also
contains the separate Admin Lab commit `6b78a2a`; remote contains the owner's
screenshot commit `30fa429`. No force push, reset, rebase or merge of peer work.

The owner requests every customer creation step to fit at 100% browser zoom on
desktop, tablet and mobile, with preview and primary actions reachable without
page scrolling. Navigation belongs at the top left.

## Changes owned by this task

- `frontend/src/customerViewport.css`: scoped customer viewport layout, compact
  progress/navigation, responsive Home hero, chooser, camera, review and result.
  Creation screens allocate the space remaining below navigation instead of
  stacking fixed-height previews. Account and kiosk styling are outside scope.
- `frontend/src/main.jsx`: imports the viewport stylesheet after existing themes.
- `frontend/src/components/customer/ClassicCaptureStage.jsx`: top-left frame/event
  navigation and persistent selected-frame preview during capture.
- `frontend/src/components/customer/ModePickerModal.jsx`: catalog pagination and
  search reset, responsive page size, existing modal focus/keyboard behavior.
- `frontend/src/components/customer/AdvancedOptionsStage.jsx`: separate frame and
  ornament tabs, pagination, preserved selected options and validation.
- `frontend/src/components/customer/PhotoStage.jsx` and `ReviewStage.jsx`: move
  navigation before the stage heading/preview.
- `frontend/src/components/customer/ResultStage.jsx`: place creation navigation
  above the result; keep image, QR and delivery actions within the viewport.
- `frontend/scripts/customer-viewport-check.mjs`: isolated browser acceptance.
- `frontend/scripts/customer-viewport-live-check.mjs`: read-only public catalog
  acceptance against the live UI or a candidate bundle, including image loading.
- `scripts/deploy_customer_viewport.py`: snapshot-based web-only preparation,
  deployment, health verification and persistent rollback.
- This handoff document.

Existing modified/untracked files in `frontend-enhanced/`, backend, other docs and
deployment scripts belong to prior work and were left untouched.

## Validation

- `cd frontend && npm test`: PASS, 103 tests.
- `cd frontend && npm run build`: PASS. Existing large bundle warning remains.
- `node frontend/scripts/customer-viewport-check.mjs`: PASS at 1366×768,
  1440×900, 1024×768, 768×1024, 390×844, 375×667, 320×740 and 844×390.
- `git diff --check`: PASS.
- Final prepared release: `npm test` PASS (101 tests in the exact live-source
  snapshot), build PASS, fixture browser acceptance PASS at all nine sizes.
- `customer-viewport-live-check.mjs` against the final prepared bundle and actual
  published catalog: PASS at all eight sizes after preview images decode.
- Image verification: nginx syntax PASS; `/v2` and nginx files preserved by hash.

Browser acceptance uses local Chromium, isolated catalog/upload/result fixtures
and the browser's fake camera. It exercises Home hero, all three mode choices,
catalog previous/next controls, event entry, live camera, first-shot review and
retake, Classic result/QR/download layout, Basic photo/review, Advanced frame and
ornament pagination/selection, photo and review. It checks element bounds,
zero page scroll and no dialog-body overflow. It makes no production requests
and performs no real AI generation. Fixture images are clearly marked test art.

Screenshots: `/tmp/nxbooth-customer-viewport/`, named by viewport and stage.
Override `NXBOOTH_PLAYWRIGHT_MODULE` and `NXBOOTH_BROWSER_EXECUTABLE` to run with a
different local Playwright installation. The defaults use the existing
`frontend-enhanced/node_modules/playwright` and installed Chromium.

These are Chromium viewport checks, not physical iPad/Safari or hardware-camera
certification. Keyboard-open, enlarged text, expired/error delivery states and a
real generation flow need separate acceptance. The public-catalog check blocks
mutating and external requests, and does not upload photos or consume credits.
The Home hero fits; optional marketing sections below the hero remain scrollable.

## Production handoff

Owner's `lanjuy` authorized the first deployment. Initial viewport web image was
`photobooth-web:customer-viewport-20261012T070218Z`, with manifest under
`/srv/photobooth/releases/customer-viewport-20261012T070218Z/`.
Only `photobooth-web` was recreated. Container health, zero restarts, web/API
requests, nginx, and unchanged other container IDs passed. `/v2` remains intact.
Previous web image was `photobooth-web:frontend-v2-20261011T062057Z`.

Actual catalog acceptance then found overflowing chooser cards caused by long
descriptions and image fallback text. The final correction gives cards bounded
image/text rows, responsive pagination and full-height modal allocation. It
passed both fixture and actual catalog acceptance before image preparation.

Current live correction (owner approved with `lanjut deploy`):
`photobooth-web:customer-viewport-20261012T085618Z`.
Release directory: `/srv/photobooth/releases/customer-viewport-20261012T085618Z/`.
Its manifest has `deployed: true`; rollback returns to the initial viewport image.
The persistent `.customer-viewport-current` pointer selects this release.
Earlier correction attempts (072021Z, 074324Z and 074739Z) were never deployed
and are superseded by 085618Z.

Preparation command: `python3 -I scripts/deploy_customer_viewport.py prepare`.
Deployment command: `python3 -I scripts/deploy_customer_viewport.py deploy`.
Post-deploy command: `node frontend/scripts/customer-viewport-live-check.mjs`.
Both PASS: healthy web, zero restarts, unchanged other container IDs, preserved
nginx and `/v2`, root/create HTML hashes matching the prepared bundle, real web
requests to health/catalog/v2 routes returning 200. Logs show normal startup.
Health API reports all checks OK. Live catalog browser acceptance PASS at eight
sizes, including decoded previews, event entry and camera-idle controls. No real
camera upload/generation was performed against production.

Current live acceptance screenshots: `/tmp/nxbooth-customer-viewport-live/`.
Prepared release test/build/browser logs are in its release directory. The
candidate live-catalog check uses `NXBOOTH_LIVE_DIST` to serve the candidate
bundle locally and proxy GET requests to the published API. All original work
and the correction are included in the requested viewport commit; unrelated work
is untouched. The primary checkout keeps its independent Admin Lab history.

## Owner screenshot follow-up, 12 October

Fetched `origin/main` read-only; owner screenshot was in commit `30fa429` at
`docs/Screenshot 2026-10-12 151543.png`. Extracted to `/tmp` without merging or
altering the working tree. The screenshot shows excessive vertical space in the
Classic heading during first-shot review, reducing the visible preview.

`ClassicCaptureStage.jsx` now uses a compact heading, a shared row for accepted
photos and remaining retakes, and concise review guidance. Scoped CSS bounds
heading size and explicitly preserves full camera video with `object-fit: contain`.
The fixture browser test now also covers the owner's 1918x872 viewport, caps
heading height at 85px, checks minimum camera/review height, and saves first-shot
review screenshots. All nine fixture sizes passed. Repo tests: 103 PASS; build
PASS (existing bundle-size warning). Read-only actual catalog acceptance passed
all eight original sizes. No real upload/generation or physical Safari test.

Review screenshot: `/tmp/nxbooth-customer-viewport/1918x872-classic-shot-review.png`.
Changes in this follow-up are limited to the Classic component, viewport CSS,
browser acceptance script and this handoff. Production now runs 085618Z. Other
admin/backend changes noticed before deploy were not included in the prepared
image. Commit/push scope is limited to the task files listed above.
