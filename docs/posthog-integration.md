# PostHog for PhBo

The active stack is React/Vite + Express. This integration does not use Django middleware.

Set `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST` on the Express API. Build the frontend with `VITE_PUBLIC_POSTHOG_PROJECT_TOKEN` and `VITE_PUBLIC_POSTHOG_HOST` for the same project. US ingest: `https://us.i.posthog.com`; EU ingest: `https://eu.i.posthog.com`. Empty configuration disables analytics in production; development reports missing configuration.

Browser events cover page views, login/logout, uploads, accepted and observed terminal generation states, kiosk design selection/capture/retake/download, and QR readiness. Server events cover API mutations, accepted generation jobs, and terminal generation states observed through polling. Terminal events describe status observation, not an independent worker completion event. Error tracking uses SDK exception autocapture, React error boundaries, and API error middleware.

Returning users are identified by `phbo-account:<verified account id>`. Anonymous browser SDK IDs are forwarded through `X-POSTHOG-DISTINCT-ID` and `X-POSTHOG-SESSION-ID`; these headers never authorize requests. Account IDs come from existing authenticated endpoints. Logout resets the browser identity.

Session replay, general autocapture, surveys and automatic page capture are disabled. No images, camera frames, email, prompts, request bodies, claim tokens, query strings or original exception messages are exported. Explicit event properties and sanitized stack frame locations are allowed.

## Validation

Run `npm test --prefix frontend`, `npm run build --prefix frontend`, TypeScript compilation and `node --import tsx --test test/analytics.test.ts test/kiosk-web-access.test.ts` from backend-express. SDK delivery and dashboard visibility require a configured project and must be verified separately; a passing build alone does not prove ingestion.

Hidden source maps are generated in `frontend/dist` and excluded from the final Docker web image. Before calling stacktrace symbolication complete, upload them with the official PostHog CLI using a scoped personal API key in a private environment, matching the deployed artifact. Never include that key in frontend configuration. Source-map upload remains pending; indexed events and saved dashboard queries have now been verified through authenticated MCP.

PostgreSQL warehouse sync is optional. Keep PostgreSQL internal; this integration does not expose the database or configure warehouse access.

## Verification on 2026-10-09

Workspace checks passed: 98 frontend tests, 134 backend tests (one existing Docker integration test skipped), frontend production build, and backend TypeScript build. Nine focused analytics/kiosk tests passed, including real Node SDK transport to a local collector and sanitized exception frames. The real browser SDK collector test passed identity reuse, logout reset, and absence of sensitive photo/prompt/email/claim data. Kiosk browser regression passed at widths 1440, 390 and 320 using a fake camera and backend fixtures; it does not verify physical hardware or paid AI generation.

Status: production SDK activation PASS after the user selected the shared Gennexbyte project. Both API and web are deployed; browser persistence is isolated per app. Dashboard creation and saved-query execution also PASS after authenticated MCP verification; real business-event coverage is PARTIAL. See [deployment verification](posthog-deployment.md) and [dashboard evidence](posthog-dashboards.md). Source-map upload, replay and surveys remain pending.
