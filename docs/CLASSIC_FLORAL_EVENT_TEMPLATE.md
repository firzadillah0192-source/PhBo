# Three-photo floral event strip

Status: PASS — assets, web form, persisted capture metadata, Python composition, embedded download QR, catalog registration and production deployment completed. Existing templates remain available; the new personalized layout is web-only.

Reference imported from `origin/main` (8327c32): `docs/1668077A-A458-4A2D-A69E-EAE890EF1CD6.PNG`. Existing workspace files were preserved; no checkout/reset or merge of unrelated upstream changes was performed.

## Deliverables

`backend/app/data/classic-floral-event-001/blank.png` and `preview.png` are exactly 1200 × 3600, 600 DPI, 1:3, with three transparent photo windows. `layout.json` contains their reviewed coordinates. The printable result remains 600 × 1800, 300 DPI, 2 × 6 inches. Normalization fills the existing canvas; it does not use contain/letterbox or extend its dimensions.

The blank has no event name, date or QR. The preview uses `Sarah & Arif`, `10 Oktober 2026` and a QR marked `Contoh QR`, pointing to the public website solely as a demo. It is not a generated customer result or a working claim for a photo. Production rendering requires the real secure result link `/r/<token>`.

Artwork was created with the built-in imagegen tool. Lettering and QR were then rendered deterministically using Python, not AI. The two versions share the exact same artwork. Fonts are bundled under `fonts/` with their OFL licenses: Great Vibes Regular (event name) and Cormorant Garamond Regular (date). Font files were downloaded from the official google/fonts repository. No font substitution or generated raster lettering is used.

## Renderer

`backend-express/python-worker/classic_event_footer.py` provides `render_footer`, `compose_event_strip` and `print_strip`. It validates size, three photographs, event name, timezone-aware capture timestamp and secure QR destination. Names are fitted into one or two lines; unsupported-length content is rejected instead of overflowing. Text, date and QR stay inside the original canvas. The date is calculated from the capture timestamp in Asia/Jakarta, never from the later rendering time. Complete photo strips are opaque RGB; photo fitting uses cover within the slots, with no outside gray bars.

Production integration includes the required name field before capture, session reload persistence, validated capture timestamps, frozen layout metadata, bundled helper fonts and QR dependency, and a real result claim persisted atomically with the result. The browser supplies the first accepted capture time; the server validates it against the upload timestamp, with an allowed one-hour window for capture/review/upload and one-minute future tolerance. A missing capture timestamp falls back to the first upload time. Dates use WIB. The 14-day claim is reused on page reload and refresh so the printed QR remains valid; deletion revokes it. Photo Booth charges 1 credit after success. The personalized layout is excluded from kiosk frame discovery; existing kiosk and legacy web frames retain their current behavior.

## Verification

Command: `/srv/photobooth/tmp/event-template-venv/bin/python backend-express/python-worker/test_classic_event_footer.py`

Six tests passed: master/slot geometry, identical preview font rendering, WIB date across midnight, composition and printing dimensions/DPI with no alpha/gray padding, QR decoding from both master and print using zxing-cpp, long names and invalid names/sizes/links/counts. Synthetic colored images were used only as local test fixtures; no provider calls or production generation/credit changes occurred.

Rebuild assets: `/srv/photobooth/tmp/event-template-venv/bin/python scripts/prepare_floral_event_template.py`. Rendering dependencies: Pillow and qrcode; test-only dependency: zxing-cpp. Installed solely into the project temporary virtual environment, with no system package changes.

## Artwork prompt

Built-in imagegen, transparent output, reference image above:

> Use case: precise-object-edit. Asset type: production blank photobooth strip overlay. Edit the provided reference, preserving its blue watercolor, white and blue flowers, gold leaf details and overall elegant floral composition. Deliver ONE clean flat 1:3 vertical PNG strip, preferably 1200 x 3600, full bleed straight rectangular edges. EXACTLY THREE large stacked rectangular photo openings, genuinely transparent alpha, not filled black, white or checkerboard. Retain clean delicate gold borders around openings. Top opening occupies y approximately 10%-29%, second y 31%-50%, third y 52%-71%, horizontally x 10%-90%. The footer y 73%-98% is opaque dark navy blue with floral decoration only at the sides, unobstructed space for dynamically rendered event name, date and a small QR code. Remove ALL existing text: Event Name, NAMES HERE, date placeholder, SCAN TO ACCESS GALLERY. Remove the entire QR code and its white square. Do not generate ANY letters, digits, labels, pseudo text, QR patterns, watermark or sample photographs. No holes or ragged outlines outside the straight outer edges. This blank artwork will later receive real font text, date and real QR with deterministic Python. Preserve the same style as the reference; no new colors or logos.

Original generated artwork is retained as `artwork-source.png`; print-ready blank and preview are the deliverables. Typography is composed with the same renderer that is intended for customer output.

## Live release and integration verification

Release `/srv/photobooth/releases/floral-event-20261010T073959Z`, deployed via `python3 scripts/deploy_floral_event.py deploy` then `status`. Only dedicated web, API, worker and image helper containers changed. Existing PostHog configuration and Google sign-in build configuration were preserved. No shared reverse proxy, database/Redis network, host ports or co-hosted app containers changed. PostgreSQL and Redis remain internal. Resources available before release: approximately 104 GiB disk, 7.1 GiB memory, four CPUs.

Registered one new layout `classic-floral-event-001`, named `Blue Floral · Nama Event`, in category `Event Kamu`. MinIO blank and preview references are `minio://catalog/classic-floral-event-001/blank.png` and `minio://catalog/classic-floral-event-001/previews/blank.png`. Preview includes sample lettering; production frame is blank until composed with user metadata. Master is 1200 × 3600, print 600 × 1800.

Validation: backend suite 136 passed with one optional real-storage test skipped; staged frontend suite passed; six Python renderer tests passed; actual Express/PostgreSQL/Python integration passed in disposable `nxbooth_credit_test`. Integration verified required/control-character name rejection, capture-time validation, idempotent retries and mismatched-name conflict, three-shot composition, 1-credit post-result settlement, 14-day persisted claim, unchanged embedded QR after reopening/refresh, QR decoding/download of both master and print, zero AI provider calls and deletion revocation without refunding used credits.

Browser harness passed at 1440/390/320px, including required name, session metadata propagation, three upload requests, capture timestamp and no overflow. Live browser checks passed at 1440/390px: template discovery, event field, three-photo actions and name persistence after reload. Public preview pixel content and JS/CSS bytes match the release. Production health reports database, Redis, storage and queue OK; helper/API/web containers healthy and worker started without errors. No synthetic production generation was created. Temporary helper and disposable PostgreSQL test containers were removed.

Commands/scripts: `frontend/scripts/floral-event-browser-check.mjs`, `frontend/scripts/floral-event-live-check.mjs`, `backend-express/test/floral-event.integration.test.ts`, and `backend-express/scripts/register-floral-event.mjs` (run as stdin from `/app` in the deployed API with `FLORAL_ASSET_DIR`). Deployment staging uses only task diffs applied to currently running sources, with a guard against concurrent release changes.

Backup: `/srv/photobooth/backups/pre-floral-event-20261010T073959Z.dump` (mode 600, metadata only). Rollback images via the release's `compose.rollback.yml`; also deactivate the new layout before rollback so older servers do not offer personalization they cannot compose. Avoid restoring a database snapshot over subsequent customer activity.

## Compact frame revision — 10 October 2026

Status: PASS, published as an asset/catalog update in `/srv/photobooth/releases/floral-frame-20261010T075215Z`. No application images or containers were replaced. New captures use this revision; existing saved results retain their original image.

Added `NXBooth` to the short header using the bundled Cormorant Garamond SemiBold font, baked into both blank and preview. The first photo now starts at y=106 instead of 470. Side borders are approximately 60/57 px instead of 150/145 px. Both inter-photo gaps are 28 px instead of 85/84 px. Combined photo area increased 45.6%. The final photo ends at y=2638 so even a two-line event name stays in the footer. Master/print sizes, footer typography, date, QR and production pricing are unchanged.

The reviewed positions are stored in `layout.json`; the editable generation source is `artwork-source-v2.png`. `scripts/prepare_floral_event_template.py` prepares master/preview, deterministic branding and checksums. The seven Python tests now include limits on borders, header height, gaps, photo coverage and separation of long titles from photo windows.

Validation commands: `/srv/photobooth/tmp/event-template-venv/bin/python backend-express/python-worker/test_classic_event_footer.py` (7 passed), `backend-express/scripts/check-floral-frame.mjs` run via stdin in the deployed API (real deployed Python compositor, three synthetic color fixtures, preserved branding, RGB 1200×3600), QR decoding of that master and its 600×1800 print, and `node frontend/scripts/floral-event-live-check.mjs` (1440/390 px). The public preview SHA-256 and catalog slots match the prepared revision exactly; `/api/health` reports OK. Checks created no production jobs, wallet charges or AI calls.

The initial helper check incorrectly compared RGBA header RGB values against a composited RGB header. Its large Buffer assertion exhausted memory while formatting the failure. The corrected check compares the flattened artwork with a bounded per-channel tolerance, avoiding large assertion diffs; it passed on rerun. Application health was verified after the test and after publication.

`backend-express/scripts/revise-floral-event.mjs` snapshots the catalog row, validates the local PNG, uploads to unique versioned MinIO paths and switches only the frame reference/slot metadata with a conditional transaction. Old objects are retained and queued jobs already have frozen frame/slot snapshots. The release stores `before.json`, `after.json`, previous assets, helper fixtures and verification logs. Rollback is a conditional catalog update: run the same script with `FLORAL_ACTION=rollback` and `FLORAL_RELEASE_DIR` set to this release, via stdin from `/app` inside `photobooth-express`. No database snapshot restoration is required.
