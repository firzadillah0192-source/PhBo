# Three-photo personalized collection

35 existing layouts are revised in `backend/app/data/classic-personalized-v3/`:
the three original Classic frames and four variants each for Idul Fitri,
Idul Adha, Khitan, Sunda, Jawa, Betawi, Minang, and Birthday. The floral event
layout remains available, for 36 layouts total. IDs, categories, and ordering
are retained; no schema, billing, provider, or customer photo changes.

Artwork is AI generated. The user explicitly authorized Python to define
precise geometry: three 1080 × 826 openings at `(60,106)`, `(60,960)`, and
`(60,1814)`. Side bezels are 60 px; gaps are 28 px. NXBooth is baked into the
short header. All pixels outside the openings are opaque; no canvas extension
or gray border is added. Each theme has a blank overlay and a sample preview.

`scripts/prepare_classic_personalized_assets.py` builds the reviewed overlays,
metadata, and checksums. Event name/date/QR use the existing Python renderer
and bundled fonts, with no AI call during a Classic session. Website and web
kiosk ask for the event name before opening the camera. Native desktop
persists the event name and first capture timestamp for its generation request.

Deployment uses `scripts/deploy_classic_personalized.py prepare`, which patches
only this task's changes onto active API/worker/frontend versions, builds
images, validates Compose, and snapshots the 35 catalog rows. Explicit approval
is required before `deploy`. `backend-express/scripts/revise-classic-collection.mjs`
validates/uploads unique versioned MinIO keys before updating all rows in one
conditional transaction. Existing assets and queued-job snapshots are retained.
`rollback` restores the previous images and catalog rows; uploaded revision
objects remain available for jobs already accepted against them.

Validation: backend typecheck/tests/build; frontend tests/build; a browser
fixture checks 1440/390/320 px, full preview, name-before-camera, three poses,
generation metadata, QR/reload, failure and revocation. Python collection tests
exercise all 35 overlays with the production compositor and decode master/print
QRs. A disposable PostgreSQL/helper integration test exercises generation,
post-result charging, claims, downloads, print and deletion for a revised theme.
Desktop event validation/persistence and build pass; full desktop tests are
limited by the VPS lacking the .NET adapter, and Electron UI is not validated.

Prepared release: `/srv/photobooth/releases/classic-personalized-20261010T103120Z`.
Review sheet: `/srv/photobooth/tmp/classic-collection-review.jpg`.
Deployed after explicit user approval on 2026-10-10. API, worker, and web use
the `classic-personalized-20261010T103120Z` images. The 35 catalog rows were
updated atomically; all 36 live layouts now expose three captures and require
an event name. Live preview bytes match the reviewed assets. Public browser
checks at 1440/390/320 px passed, with real catalog/preview responses and no
generation or API interception. Health checks pass and restart counts are zero.
Other containers were unchanged. The Electron desktop application was not
distributed or deployed to a physical kiosk.

Deployment evidence: `deploy.log`, `deployment.json`, `live-assets-check.json`,
and `live-browser/report.json` in the release directory. Rollback images and
the previous catalog snapshot are retained.

| Check | Command / artifact | Result |
| --- | --- | --- |
| Backend | `npm run typecheck`, `npm test`, `npm run build` | PASS; 141 passed, 1 skipped |
| Frontend | `npm test`, `npm run build` | PASS; 99 passed |
| Python | `python -m pytest test_classic_collection.py test_classic_event_footer.py -q` in isolated venv | PASS; 8 tests and 35 theme subtests |
| Browser | `KIOSK_PERSONALIZED=1 node scripts/kiosk-flow-check.mjs` against prepared frontend with HTTP fixtures | PASS; 1440/390/320 px |
| Integration | `node --import tsx --test test/floral-event.integration.test.ts` with revised Jawa assets and disposable services | PASS; real composition, QR, charging, delivery, deletion |
| Desktop focused | `node --test --test-name-pattern='Personalized desktop' tests/core.test.mjs`, `npm run build` | PASS |
| Desktop full | `npm test`, `npm run test:ui`, `xvfb-run -a npm run test:ui` | PARTIAL; 5 passed / 3 adapter failures; UI launch not validated |

Release audit: `validation.json` in the prepared release directory. Production
images were verified unchanged after testing. Disposable test containers and
the local browser preview server were stopped and removed.
