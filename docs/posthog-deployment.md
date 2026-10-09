# PhBo PostHog activation — 2026-10-09

Status: PASS for production SDK activation and app health; dashboard display/source-map symbolication remain unverified.

PhBo uses the existing Gennexbyte PostHog project as explicitly selected by the user. Events use `app: phbo`, while Gennexbyte uses `app: gennexbyte`. Browser SDK persistence is named `phbo` with cross-subdomain cookies disabled, so independent signed identities do not overwrite Gennexbyte analytics state. Referrer/campaign persistence and unused feature flag evaluation are disabled. Replay, generic autocapture and surveys remain disabled; photos, prompts, email, claim tokens, request bodies and original exception messages are excluded.

The deployment overlays only analytics onto the exact active photo-management source/image snapshots. Existing payment, photo-management, retro UI, Google kiosk protection and generation/media contracts are preserved. API tracing headers are correlation only; they never authenticate. Users are identified through existing signed account/kiosk endpoints.

## Verification

- Active-release TypeScript build PASS; frontend Vite build PASS.
- 97 active-release frontend tests PASS after restoring three test-only Classic JSON fixtures omitted by the release snapshot.
- Nine focused backend SDK/auth tests PASS, including real SDK local-collector transport and exception sanitization.
- Browser SDK collector PASS: verified identity reuse, logout reset, sensitive-data exclusion, and per-app persistence isolation.
- Kiosk regression PASS at 1440/390/320 pixels locally and against deployed static assets. Camera, Google and backend responses use fixtures; no physical device test, real Google impersonation or paid generation was performed.
- Actual production API SDK emitted `phbo_runtime_verified` with `is_test: true`; `/batch/` returned HTTP 200. This is a diagnostic event, not a business conversion. Dashboard indexing/display is not claimed.
- Web/API/gateway health PASS, `/kiosk` publicly reachable. Database, Redis, storage and queue checks are healthy.

## Deployment

API image: `photobooth-express:posthog-20261009`.
Web image: `photobooth-web:posthog-isolated-20261009`.
Override: `/srv/photobooth/releases/posthog-20261009/compose.posthog.yml`, appended to existing PhBo Compose stack. Rollback override retains preceding photo-management images. Only API/web containers were replaced; worker, database, Redis, gateways, image helper, network, ports and Gennexbyte containers were retained. Existing API runtime environment values were compared with merged Compose before startup. The existing image-engine key was supplied from the running API environment without printing or altering it. Compose config was validated before startup.

SDK packages are pinned. Public ingestion configuration was read from environment files; no credentials are in this report or committed. Hidden frontend maps are retained in build output but excluded from the web overlay. Previously hashed static assets remain in the image for existing open pages. No migrations, seeds or hardware jobs ran.

Evidence is in this release directory: frontend-tests.log, frontend-build.log, api-compile.log, backend-analytics-tests.log, sdk-browser.log, kiosk-browser.log, kiosk-production-browser.log, posthog-runtime-delivery.log, and image build logs.

## Remaining roadmap

Confirm Events in PostHog with filters `app = phbo` and `app = gennexbyte`; diagnostic events have `is_test = true`. Existing Gennexbyte conversion dashboard remains intact. Creating/querying new PhBo dashboards requires authenticated PostHog access, which is unavailable in this session. Source-map upload, replay and surveys remain separate work. Worker terminal events are observed by API polling; this integration does not independently instrument worker job completion or export worker logs.
