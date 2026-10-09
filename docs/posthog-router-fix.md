# PhBo missing generation analytics — 2026-10-09

Status: PASS for reproduced defect, regression tests, API deployment and indexed SDK diagnostics. The existing user generation is now visible in the PhBo dashboard: one accepted job, one observed completed job and web funnel person counts 1 → 1 → 1. This is a single observed run, not a business success-rate estimate.

## Cause and correction

Express rewrites `req.path` while running mounted routers. The analytics response hook tested that rewritten path for `/api/`, so real web and kiosk router responses skipped backend analytics. Earlier tests mounted handlers directly on the app and missed the production behavior. Browser upload/acceptance/completion events were independently indexed; the server-only job tiles stayed at zero.

The middleware now captures the original request path before router dispatch, strips its query string and uses the stable path for eligibility, surface selection, authenticated login response matching and job-state events. Request bodies, images and query values remain excluded. Mounted admin routes remain excluded.

Accepted-job and observed-outcome insights now combine their existing browser and server observation events with native `GroupNode` OR series and `uniqExact(properties.job_id)`. They count distinct job IDs rather than adding event totals. This displays the previously indexed browser run without fabricating historical server events. Outcomes still describe observed terminal state, not independent worker telemetry.

## Evidence

- New web and kiosk mounted-router tests reproduced the failure before the fix: both expected a queued/terminal event but received none.
- `node --import tsx --test test/analytics.test.ts test/kiosk-web-access.test.ts`: 11 tests PASS after the fix, including repeated terminal polling, stable redacted route paths, surface attribution, privacy, SDK transport and existing kiosk authorization.
- Isolated TypeScript compilation of the changed deployed module and its exact active AppError definition: PASS.
- API image `photobooth-express:posthog-router-fix-20261009` overlays only the analytics source and compiled module onto the preceding API image.
- Docker Compose configuration passed; every API environment value matched the prior container before recreation. Only `photobooth-express` was recreated. API health returned database/Redis/storage/queue/provider checks OK; the container is healthy. Web, worker, gateways, database, network and ports were retained.
- The deployed module was exercised with isolated mounted Express fixture routers and the real configured SDK. Six events were captured with `is_test=true`; authenticated PostHog queries confirmed indexed web/kiosk acceptance and terminal diagnostics. These tests created no production generation jobs or photos and consumed no AI credits.
- Forced refresh of the saved PhBo visitor, web funnel, accepted-job and observed-outcome tiles returned the existing non-diagnostic browser run, with no query warnings. The two diagnostic job IDs are excluded from those counts.

Release files: `/srv/photobooth/releases/posthog-router-fix-20261009/`. The appended Compose override is `compose.router-fix.yml`; the complete command is recorded in `validated-compose-command.json`. Rollback: restore the preceding API image `photobooth-express:posthog-20261009` using the preceding Compose command.

The real browser generation occurred before the API fix. Its backend events were not backfilled. Future requests use the repaired middleware; closing a browser before terminal polling can still leave an unobserved terminal state. Earlier activity predating instrumentation cannot be reconstructed from PostHog. Source-map upload, session replay and physical camera/printer verification remain outside this fix.
