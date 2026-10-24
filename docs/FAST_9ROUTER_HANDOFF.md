# Fast generation through 9Router — prepared, not deployed

Owner request: Standard 50 AI credits through `cx/...`; Fast 100 through
`openai/...` on the same 9Router gateway. Keep quality Low and existing prompts.

## Application changes

- `backend-express/src/services/generation-api-routes.service.ts`: both lanes use
  NativeNineRouterProvider, gateway endpoint, and Low. Fast defaults to
  `openai/gpt-image-2.5-flare`. Existing bare Fast model IDs are prefixed on read;
  no production SQL update or schema migration. Standard saves require `cx/`;
  Fast saves require an OpenAI image model with the `openai/` prefix.
- Fast inherits saved Standard gateway credentials or server gateway credentials.
  Existing Fast direct-OpenAI encrypted credentials are ignored and retained for
  rollback. New explicitly saved Fast gateway overrides use `9router:v1:` before
  the ciphertext in the existing text column. Clearing restores inheritance.
  No secret is returned in route responses or audit metadata.
- Admin `GenerationApiRoutes.jsx` describes both gateway routes and gateway keys.
- Routing tests cover reference order, Low, selected model, inherited/overridden
  credentials, legacy credential isolation, no cross-lane fallback, missing
  endpoint/credentials, and model-prefix validation.
- Integration fixture model IDs updated; integration tests were not run against
  production or any database.

## Gateway prerequisite

The running 9Router process (port 20128) has cwd
`/home/mahez/9router-releases/telemetry-a8c9d380-20260923T1700Z`. Its image route
bundle currently contains an OpenAI adapter that omits `image` / `images`.
Historical OpenAI gateway requests on 2026-10-14 reported zero image input tokens.
Application routing changes must not be deployed by themselves.

Prepared review artifact:
`scripts/patches/9router_openai_reference_edits.patch`.

Patch scope: OpenAI image adapter, image core URL builder call, one unit test file.
It uses `/v1/images/edits` with multipart `image[]` for OpenAI references, retaining
reference order, prompt, size and Low quality. It supports data URIs and URL
references through the gateway's existing bounded, SSRF-protected image-fetch
helper. Failed reference retrieval raises an error rather than generating without
references. GPT Image edits omit legacy `response_format`; multipart leaves
Content-Type to fetch. Text-only generation and other provider adapters retain
their existing behavior.

Only the isolated copy `/tmp/nxbooth-fast-gateway-review` was changed. The live
9Router release and `/home/mahez/9router-dev` application source were not edited.
The patch is persisted here; the temporary copy is not a deployment definition.

## Validation

- Backend: `npm run typecheck`, `npm test`, `npm run build`: PASS.
  295 passing tests, 1 skipped, 0 failed. No database migration was applied.
- Frontend: `npm test`, `npm run build`: PASS. Existing duplicate-property and
  bundle-size warnings remain in unrelated frontend code.
- Gateway isolated copy: `vitest run --config tests/vitest.config.js
  tests/unit/openai-reference-edits.test.js tests/unit/image-generation.test.js
  tests/unit/codex-image-models.test.js`: 33 tests PASS, including core transport.
- Additional pre-existing `image-fetch-hardening.test.js`: 8 pass, 1 fail
  (`accepts valid PNG from public host`). Its lookup mock returns an object while
  current helper uses `lookup(..., {all:true})` and expects an array. Both the
  helper and test are unchanged from the baseline; do not attribute that failure
  to this patch or report the entire gateway suite green.
- No paid image generation, actual remote URL fetch or live-flow acceptance run.

## Deployment and rollback requirements

Owner approval is required for deployment. Before rollout, verify peer channel,
release activity, Docker safety checks, and express snapshot validation PASS.
Prepare isolated releases from live source, applying only the reviewed delta;
never deploy the whole dirty Photobooth tree or rebuild the live 9Router in place.
Gateway reference support must be active before Fast uses it. API, worker and web
then need their scoped changes deployed. Keep persistent release definitions,
source hashes and rollback artifacts under `/srv/photobooth/releases/`.

Existing Fast row currently contains a bare model and old direct key; the new
application can use the inherited gateway credential without modifying that row.
Do not save a new Fast gateway override before confirming rollback behavior: an
old application cannot decrypt the version-prefixed new credential. If an override
is saved, rollback needs the previous Fast row restored or Fast disabled by the
owner; never expose decrypted credentials.

After approved rollout, validate container health/logs, snapshot generate+validate,
real web requests, and an explicitly approved paid generate with both references.
Verify frame retention and actual upstream OpenAI selection, not HTTP 200 alone.

Live at handoff (unchanged):
- API/worker: `photobooth-express:generation-webhooks-20261018T181825Z`
- Web: `photobooth-web:customer-ui-20261019T081058Z`
- Helper: `photobooth-express:floral-event-helper-20261010T073959Z`

All task changes remain uncommitted. No deployment or production configuration
change was made. Overall status PARTIAL pending approved release and live quality
validation. Other pre-existing dirty files belong to prior work and were retained.

## Approved deployment attempt — 2026-10-20

Owner approved deployment in chat. Preflight Docker/network/resources and snapshot
validation passed. Scoped release fully prepared:
`/srv/photobooth/releases/fast-router-20261020T073712Z/manifest.json`.
API and worker images: `photobooth-express:fast-router-20261020T073712Z` and
`photobooth-express:fast-router-20261020T073712Z-worker`.
Admin-only web release: `/srv/photobooth/releases/customer-ui-20261020T073737Z/`.
Its build, tests and browser checks passed at all nine existing viewport sizes.

Gateway deployment artifact changes only the OpenAI adapter webpack module and
its two URL-builder calls in the current live route bundle. The reviewed adapter
and its existing protected URL-fetch helper are bundled into a self-contained CJS
file under this persistent release. The existing provider registry is injected;
no unrelated gateway routes, provider settings or service definition are rebuilt.
Original route bundle and rollback compose files are retained. Production CJS
adapter and webpack module smoke tests passed without upstream requests.

DEPLOYMENT BLOCKED BY OS PERMISSION: `sudo -n systemctl is-active 9router.service`
returns `sudo: a password is required`. No attempt was made to bypass sudo by
killing the service or using a different restart mechanism. The deploy script
fails before any live mutation when not root. Owner command:

```sh
sudo python3 -I /opt/photobooth/scripts/deploy_fast_router.py deploy
```

This applies the gateway patch, restarts only 9router.service, deploys the prepared
web/API/worker images, verifies health and routing, and refreshes the compose
snapshot. `scripts/verify_fast_router.mjs` runs inside the API container: it reads
route settings and captures requests using a test transport, then checks the live
gateway rejects invalid reference encoding locally. An invalid quality enum also
prevents paid generation if the old adapter were inadvertently active. No real
photo is sent by that verification.

Rollback, if required, uses the same script with `rollback` and sudo. If deployment
fails halfway the manifest reports ROLLBACK_REQUIRED; run rollback before retrying.
No rollout command was successfully activated in this session. Gateway file hash,
all running container IDs/images, and compose snapshot remain at the old healthy
baseline. New source files and deployment scripts remain uncommitted.

## Owner deployment completed and independently verified

Owner ran the sudo deploy command successfully. Manifest status DEPLOYED at
2026-10-20T07:42:53Z; OS blocker is resolved. Active image tags are:
- API: `photobooth-express:fast-router-20261020T073712Z`
- Worker: `photobooth-express:fast-router-20261020T073712Z-worker`
- Web: `photobooth-web:customer-ui-20261020T073737Z`

Independent post-deploy checks PASS: live gateway bundle hash matches prepared
artifact; 9router.service active with NRestarts=0; API/web healthy and worker
running with zero container restarts; startup logs clean; compose snapshot
validate PASS; localhost web `/api/health` and `/create` HTTP 200; public HTTPS
health reports all database/Redis/storage/queue/provider checks OK. Default Python
User-Agent initially received 403; a browser User-Agent returned HTTP 200.

Re-ran the no-paid-generation routing verifier inside the active API container:
Standard 50 -> cx/gpt-image-2.5, Fast 100 -> openai/gpt-image-2.5-flare, both Low.
Gateway rejects invalid reference encoding locally (PASS), proving that the new
adapter consumes the image fields rather than silently omitting them. Actual
image quality remains untested: no new paid generation or customer image was sent.
Source changes remain uncommitted; unrelated dirty work is retained.

## Fast model changed to Sunburst — 2026-10-20

Owner requested replacing Flare with Sunburst. Used the active
GenerationApiRoutesService.save (with audit actor `owner-via-codex`) to set the
existing Fast row to `openai/gpt-image-2.5-sunburst`, preserving enabled state and
credentials. No schema migration, image deploy or restart. Standard remains
`cx/gpt-image-2.5` / 50; Fast remains 100; both Low. Active routing and gateway
reference verifier PASS after the update. No paid image generation was run.
