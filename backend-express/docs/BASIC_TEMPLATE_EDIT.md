# Basic template identity editing

Basic sends the actual registered PNG as image 1 and a validated user JPEG as
image 2 through the existing provider adapter. The selected model, credentials,
routing, telemetry and one-credit reservation/settlement rules are unchanged.
Advanced retains its single-image request contract.

New Basic jobs store version 2 engine snapshots containing the composed prompt,
model, content-addressed template reference, SHA-256 and actual PNG dimensions.
Registry replacement cannot silently change a queued job. Existing version 2
jobs retain their frozen prompt and model. Completed historical results and
failed jobs are not rewritten.

## Current output policy

At the operator's explicit request, Basic exposes the AI edit directly. There is
no post-generation face detector, landmark alignment rejection, facial mask,
local face blending or pixel restoration. The old Python composition endpoint
remains available internally for compatibility but is not called by Basic.
Template fidelity and identity are controlled by the prompt and visually reviewed
by the operator; exact frame or branding pixel preservation is not guaranteed.

The current prompt requests subtle, template-dominant resemblance. Image 1
controls the broad facial silhouette/proportions, head placement, hair,
complexion, lighting and the entire framed scene. Image 2 supplies gentle eye,
eyebrow, lip and nose resemblance cues. Only small smooth contour adjustments
are permitted; the complete source cheek/jaw/chin outline must not be copied.
The source eye shape must not be enlarged or beautified. Eyeglasses follow the
source design, fitted naturally to the blended template face.

An explicit natural visual merge instruction requests the template skin material,
scene lighting and photographic finish, with soft transitions at temples,
cheeks/jaw/hairline/neck. Source images supply feature cues rather than copied
pixels or webcam lighting. This supersedes the stronger source-anatomy prompt,
which the operator found too literal and sharply defined.

The provider is still a generative image-edit adapter, not a dedicated face-swap
model. Visual resemblance and the degree of blending require operator review;
there is no claimed exact identity guarantee or numeric blending ratio. No
post-generation landmark rejection or local face blending is used.

Source-photo validation, template preparation and frozen asset integrity checks
still run before the paid provider call. Template context detection uses the
existing detector/model/thresholds. Provider responses still undergo technical
image validation and the worker creates the ordinary shared Result. If the
returned PNG already has the registered canvas dimensions, its bytes pass through
unchanged. Otherwise the entire image is fitted to the registered canvas without
stretching or cropping, using white padding when ratios differ. Basic output
uses template dimensions rather than the Advanced 2160 x 3240 master.

## Validation

- 115 backend tests passed; one optional live MinIO test skipped.
- Earlier baseline validation passed 70 frontend and 17 image-helper tests.
  This prompt-only release changes neither frontend nor Python helper.
- Backend/frontend production builds, backend Docker build and diff check passed.
- Disposable PostgreSQL account/credit/Result/QR/download integration passed.
- Prior Royal Nusantara diagnostics reproduced the old alignment rejection and
  confirmed the direct-output runner preserves the provider image.
- One fresh Royal Nusantara diagnostic used the latest completed job photo and
  the softer template-dominant prompt. Visual review showed less source jaw/cheek
  dominance and a smoother model-like facial presentation. This is one example,
  not an identity-quality PASS. No customer job or account credit was used.
- Public production health reported all dependencies healthy.

The diagnostic images are private and outside the repository. Detection and
byte-preservation checks do not establish identity quality. New-generation
likeness, frame fidelity and branding need visual acceptance. No experimental
Basic V2 or additional face-swap model weights are enabled.

## Active release

Released 2026-10-06: `photobooth-express:basic-soft-20261006T090521Z` for API
and worker. The durable Compose override is
`/srv/photobooth/releases/compose.basic-soft-20261006T090521Z.yml`; append it
after the active override chain for scoped operations. The image helper remains
`basic-face-20261006T031331Z`, and frontend remains
`retro-20261006T055419Z`. Only API and worker were recreated, with
unchanged environment settings. No production migration was applied.
Previous API/worker image `basic-likeness-20261006T065038Z` remains available for
rollback; it restores the stronger source-anatomy prompt. Retain the provider
transport override on rollback to avoid restoring the public proxy timeout.

Historical failed jobs remain FAILED with their credits REFUNDED. The latest
customer Basic job completed before this prompt revision and is not overwritten.
Customers must start a new Basic generation to use the softer resemblance prompt.
The new prompt is not substituted into historical frozen snapshots.


## Provider transport correction

Two Arctic Expedition jobs failed with HTTP 524 after approximately 125 seconds
while the application used the public Cloudflare-proxied provider URL. The local
provider endpoint accepts the same application key and returns the same model
catalog as the public endpoint. One direct diagnostic with the failed job photo,
frozen prompt/model and template returned a real image in 95 seconds, without
creating a customer job or charging account credits.

NXBooth API and worker now use `http://host.docker.internal:20128/v1` for
`NINEROUTER_BASE_URL`. Only this application connection setting changed; provider
model/routing/credentials/rotation/telemetry, prompt, credits and all application
images are unchanged. The existing 300-second application timeout remains.
9Router, Cloudflare, frontend, database, Redis and the Python helper were not
modified or restarted by this correction. A private environment backup was made
before changing the setting. Both application services retain their existing
host-gateway mapping. The active Compose chain must retain the provider transport
override when recreating services.

Cloudflare documents HTTP 524 as an origin response timeout (125 seconds by
default):
https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/

Failed historical jobs remain failed and refunded. The diagnostic proves one
successful provider request and avoids the public proxy deadline; it does not
guarantee that the underlying AI service will always finish within 300 seconds.

Transport override: `/srv/photobooth/releases/compose.provider-direct-20261006T090059Z.yml`. Post-release validation: public
health and deployed Arctic replay passed; provider pixels stayed unchanged.
Backend regression: 115 passed, one optional live MinIO test skipped.
