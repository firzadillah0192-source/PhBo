# Desktop AI generation failure, 17 October 2026

Status: gateway fix deployed; 32 scoped unit tests and one real synthetic image test passed. A new customer desktop session has not been exercised by the agent.

## Evidence

- Basic jobs at 18:32 and 18:42 WIB failed with `AI_PROVIDER_ERROR` / HTTP 400. The separately deployed `provider-payload-20261017T124756Z` change removed an invalid legacy parameter and added sanitized upstream diagnostics.
- Two later Basic jobs (`cc6eab666cfd6bab282add23f2214e92` at 20:14 WIB and `e2f43a1c92c9251d8cc5545aa9e2ae3d` at 20:16 WIB) still failed. Their stored upstream error says the Responses model `gpt-5.5` is unsupported for the connected ChatGPT account.
- The live gateway's image adapter mapped `gpt-image-1.5`, `gpt-image-2` and the `gpt-image-2.5` variants to that fixed Responses model. The actual upstream catalog, requested with the gateway's current CLI version, offers `gpt-5.6-sol` on both active connections and does not offer `gpt-5.5`.
- The two latest failed jobs have `quota_reservations.status = REFUNDED`. The latest also has a `REFUNDED` generation charge record. Historical jobs were not reset or replayed.

## Authorized change

The owner explicitly authorized fixing the existing gateway outside the photobooth directories and testing one synthetic image. No customer photos were read or used.

- Gateway source: `/home/mahez/9router-dev/open-sse/config/imageConstants.js` provides `CODEX_IMAGES_MAIN_MODEL` (environment override, default `gpt-5.6-sol`). The image adapter imports this configuration instead of fixing the Responses model to `gpt-5.5`.
- Requested image tool models, accounts, credentials, rotation, image references and the existing telemetry changes are preserved.
- Runtime: exactly one mapping expression was patched in `/home/mahez/9router-releases/telemetry-a8c9d380-20260923T1700Z/.next/server/app/api/v1/images/generations/route.js`. A full rebuild of the dirty gateway tree was deliberately avoided. The source correction is present for future builds.
- `systemctl restart` and noninteractive sudo were denied by OS authentication. The owner restarted `9router.service`; its PID changed from 867 to 83204, with active/running state and no restart loop. No permission bypass was used.
- No photobooth container, desktop installer, schema, prompt or customer credit balance was changed by this session.

## Validation and handoff

- Gateway tests: `npm test -- unit/codex-image-main-model.test.js unit/codex-image-models.test.js unit/image-generation.test.js unit/provider-operational-metadata.test.js` in `/home/mahez/9router-dev/tests`: **32/32 PASS**. The previous integration assertion for the obsolete Responses model was updated; image tool selection and reference forwarding remain asserted.
- Patched runtime JavaScript: `node --check` passed.
- Real synthetic geometric-card image: direct patched adapter to the real upstream, HTTP 200 in 25,498 ms; readable PNG, 1254 × 1254, 1,122,595 bytes, different from the input. This was one real image generation, without creating a customer job or replaying a customer photo. It validates upstream execution, not a complete desktop session.
- After the owner's restart, the application worker reached the gateway image catalog (HTTP 200, configured image model present). A no-generation POST with an empty prompt returned the expected validation HTTP 400 rather than a provider call.
- Start a **new** desktop session with **Mulai ulang** to retry. Old failed jobs remain failed/refunded and do not become successful automatically.

Release record, original runtime/source backups, exact source-only patch, patched bundle and synthetic test evidence: `/srv/photobooth/releases/gateway-image-model-20261017T132500Z/manifest.json`. Synthetic input/output are under `/srv/photobooth/tmp/gateway-image-model-20261017T132500Z/`.

Gateway source fix is committed as `ee2ea498ba64e944e3be7c6d2da2fa85184d8ae7`, retained on local branch `fix/image-responses-model-20261017`. Only the configuration, handler import/constant and two test files are committed. The gateway's pre-existing telemetry edits remain uncommitted. An isolated copy containing only the exact staged commit delta passed **29/29** image tests, separately from the earlier 32 tests with telemetry present.

The reproducible commit delta is also versioned in Photobooth as [gateway_image_responses_model.patch](../scripts/patches/gateway_image_responses_model.patch); apply it from a compatible gateway source root with `git apply --check` before applying. The release directory retains both the original working-tree delta (`source.patch`) and commit delta (`commit.patch`). Photobooth's unrelated working-tree changes were preserved. These commits have not been pushed.

Rollback, if explicitly requested: restore the release's `live-route.before.js` to the runtime route path recorded in the manifest, then have an administrator restart `9router.service`. Restoring it reinstates the known unsupported mapping; it is a rollback mechanism, not the recommended recovery.
