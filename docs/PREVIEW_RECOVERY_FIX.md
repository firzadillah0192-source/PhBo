# Photo Booth preview recovery

The reported "Preview belum tersedia" could not be reproduced in a fresh
public-browser session: all 36 Photo Booth cards loaded HTTP 200 images.
Inspection did reproduce two related defects:

- `CatalogImage` permanently replaced a failed request with its fallback and
  did not recover when `src` changed. A transient failure during deployment or
  an interrupted request could therefore persist for the life of the card.
- Classic preview selection compared local MinIO cache file modification times.
  Those reflect download order; re-downloading a master after its preview could
  wrongly select the blank frame instead of the sample preview.

Changes: `frontend/src/components/home/ModeCards.jsx` retries a failed image once
  after 750 ms, resets when its source changes, and cancels pending retries on
  unmount. Permanent failures still show the honest fallback. There is no loop.
`backend-express/src/services/catalog-assets.service.ts` compares stored object
revision times (or imported source timestamps when both are present), retaining
local-file freshness checks and blank fallback for genuinely outdated/missing
previews. API paths/responses and template assets are unchanged.

Validation:

- Backend: `npm run typecheck`, `npm test`, `npm run build`: PASS; 142 tests
  passed, one optional MinIO integration skipped. A regression test warms the
  cache in reverse order and checks fresh, superseded, and missing previews.
- Frontend: `npm test`, `npm run build`: PASS; 99 tests passed.
- `node scripts/catalog-image-recovery-check.mjs`: PASS; real browser checks
  interrupted first image request, one successful retry, bounded permanent
  failure, source replacement, and unmount cleanup.
- Live inspection: public Photo Booth chooser, all 36 cards, no unavailable
  fallbacks in the fresh session. The user's existing session was not inspected.

`scripts/deploy_preview_recovery.py prepare` patches only these two changes
onto the currently running API/worker/frontend images, preserving the concurrent
retro UI release. Rollback overrides are included. This fix requires explicit
deployment approval. It was subsequently included in the approved
`classic-event-flow-20261010T112140Z` release and is live; see
`CLASSIC_EVENT_FLOW_FIX.md` for deployment evidence.
