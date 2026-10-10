# Classic event submission and two-step capture

The live website reproduced `EVENT_NAME_REQUIRED` after a user entered a name:
`App.jsx` only added `event_name` and `captured_at` for the Floral template ID.
Other personalized layouts saved the name correctly but omitted it from the
generation request. The reproduction used intercepted upload/generation writes
and synthetic fixtures; no production job or credit was created.

`frontend/src/App.jsx` now uses the selected layout's `requires_event_name`
metadata and the matching saved event-layout ID. All personalized Classic
layouts send the name and capture timestamp; unrelated layouts receive neither.

`frontend/src/components/customer/ClassicCaptureStage.jsx` now has two steps:
event name, then photo capture. Initially only the name form, continue button,
and frame preview appear; the camera and upload controls are absent. Continue
opens the capture step at the top of the page. The large preview/form are removed
from that step. Users can change the name before accepting their first photo.
Saved names survive reload; accepted capture sessions retain their metadata.

Validation: frontend `npm test` (99 passed), `npm run build`, staged source build,
and `node scripts/classic-event-flow-check.mjs`. The browser test uses the actual
App callback on desktop/390/320 px with Floral, Jawa and Birthday layouts. It
checks name persistence, separate steps, a visible continue button, three actual
fake-camera captures or synthetic file uploads, event metadata and idempotency
in the generation request. HTTP responses are fixtures; no generated result is
fabricated or asserted. Preview checks use
`FRAME_PREVIEW_SOURCE=<prepared frontend> node scripts/frame-preview-browser-check.mjs`.

Combined release: `scripts/deploy_classic_event_flow.py` includes the previously
prepared preview recovery/freshness fixes (see `PREVIEW_RECOVERY_FIX.md`). It
patches three frontend files and one backend service over the currently live
retro UI/API/worker images. No template, schema, wallet, provider or kiosk device
change is included. Explicit deployment approval is required; rollback overrides
are retained. Prepared release:
`/srv/photobooth/releases/classic-event-flow-20261010T105612Z`.

Evidence: `/srv/photobooth/tmp/classic-event-flow-before.json`, browser report and
screenshots under `/srv/photobooth/tmp/classic-event-flow-browser/`, and staged
build/Compose logs in the release directory.

Deployed after explicit approval on 2026-10-10. The release was rebased onto the
newer `retro-ui-20261010T111301Z` frontend before deployment, preserving that UI.
Active release: `/srv/photobooth/releases/classic-event-flow-20261010T112140Z`.
All three images are running, API/web health checks pass, and restart counts
are zero. Other containers are unchanged. Live HTTP checks verify all 35 revised
sample previews exactly; the catalog still has 36 layouts. Public live-browser
checks pass at 1440/390/320 px for the separate event step and submitted metadata.
Upload/generation requests were intercepted in those browser tests; no production
generation was performed. Evidence: `deploy.log`, `browser-live.log`,
`live-assets-check.json`, and `deployment.json` in the active release directory.
