# Single-window Classic frame revision

The user requested one long photo opening instead of three visible template
boxes. All 36 current themes keep their existing artwork, NXBooth header,
event typography, date and download QR. The master stays 1200 × 3600 at 600 DPI;
the print download stays 600 × 1800 at 300 DPI.

The overlay has exactly one transparent rectangle: x=60, y=106, width=1080,
height=2532. Three photos are placed consecutively at y=106, 950 and 1794,
each 1080 × 844. There are no intervening frame lines, gaps, overlaps or extra
canvas padding. Three placement rectangles remain in internal metadata so
the current compositor can fit each capture; they are not three frame openings.
The existing centered cover crop is retained.

Files:

- `scripts/prepare_classic_single_window.py` builds blank/preview/layout/checksums
  in `backend/app/data/classic-single-window-v4/` using existing approved artwork.
- `backend-express/python-worker/test_classic_single_window.py` checks every
  alpha pixel, every photo placement pixel, untouched exterior artwork, fully
  opaque final composition, and readable QR in master and print for all themes.
- `backend-express/scripts/revise-classic-single-window.mjs` uploads new
  versioned object keys and conditionally updates all 36 existing catalog rows
  in one transaction, with before/after snapshots and rollback.
- `scripts/deploy_classic_single_window.py` prepares/releases assets only.
  No frontend/API/helper image replacement or container restart is needed.

Prepare with `python3 scripts/deploy_classic_single_window.py prepare`.
Deploy only after explicit user approval with the same command ending `deploy`.
Use `rollback` to restore catalog metadata. Historical objects and accepted
job snapshots remain intact; already generated results are not rewritten.
No schema or API contract change is made. Website and kiosk use the same catalog.

Deployed release (explicit user approval on 2026-10-10):
`/srv/photobooth/releases/classic-single-window-20261010T120247Z`.
`comparison.jpg` shows old/new previews; `collection-review.jpg` covers all
36 themes. `check-helper.mjs` exercises the active private helper via the
actual Express engine bridge using synthetic red/green/blue photographs only.
It checks corners at both sides of each seam, validates every overlay through
the active catalog validator, and writes `helper-verification.json`.
This exercise creates no customer uploads, jobs, results, claims or credit entries.

Validation commands: isolated-venv `python -m pytest test_classic_single_window.py
test_classic_collection.py test_classic_event_footer.py -q`; `node --check
backend-express/scripts/revise-classic-single-window.mjs`; Python `py_compile`;
`git diff --check`. Backend/frontend build suites are not rerun because their
runtime sources are unchanged. Physical camera/kiosk acceptance is not performed.

Validation result: **PASS** — 9 tests / 71 theme subtests; all 36 layouts
validated and composed through the active private helper, with no seam errors.
QR decoding passed at master and print sizes. Release is now **deployed**.
`validation.json` and `helper-verification.json` record these results.

Deployment: **PASS**. `python3 scripts/deploy_classic_single_window.py deploy`
published all 36 catalog rows atomically. Public preview bytes and placement
metadata match all 36 reviewed assets. Browser checks against the actual public
website at 1440/390/320 px passed with no API interception or generation writes.
A synthetic request used the newly published catalog, real frozen-frame service,
and active private helper; photo seams, master/print sizes and QR decoding passed.
Compose config/ps, logs, local/public health and zero restart counts passed.
All containers retain their IDs/images; no other project resources changed.
Rollback restores the retained catalog snapshot. Evidence is in `deployment.json`,
`deploy.log`, `public-verification.json`, `live-generation-verification.json`,
and `live-browser-verification.json` in the release directory. Physical camera
and kiosk-device acceptance remain manual; existing results are not rewritten.
