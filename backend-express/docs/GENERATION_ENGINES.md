# Generation engine integration

The existing Express flow remains kiosk upload -> photo session -> browser claim ->
PostgreSQL queue -> Node worker -> MinIO result -> polling. Photo session credentials and expiry are stored in PostgreSQL. BASIC and ADVANCED both generate with NineRouter through the Express provider abstraction. CLASSIC remains the separate local frame compositor.

| Mode | Engine | Credit policy |
| --- | --- | --- |
| CLASSIC | Python compositor, 1–4 photos fitted to transparent frame slots | No AI credit |
| BASIC | NineRouter with server-owned prompt based on the selected template | One AI credit |
| ADVANCED | NineRouter with server-owned experience and frame prompts | One AI credit |

CLASSIC accepts 1–4 photos. A frame is required when selecting multiple photos;
one photo without a frame returns the original as PNG. `frameId` is validated as
active. CLASSIC rejects AI selections and does not reserve AI credits.

Upload 1–4 files in repeated multipart field `image` to `POST /api/v1/photo-sessions`
with the kiosk key. The response includes `photos` in upload order; legacy `photo`
remains the first photo. Use returned photo IDs when creating a generation.
Only photos from the claimed session can be selected. BASIC/ADVANCED accept one
photo ID and default to the first photo; CLASSIC defaults to all session photos.
Selection order is saved on the job and is part of idempotency matching.

## Requests

POST `/api/v1/generations` still requires the claimed session cookie and an
`Idempotency-Key`. Examples:

```json
{"sessionCode":"<session-code>","mode":"CLASSIC","frameId":"<frame-uuid>","photoIds":["<photo-uuid-1>","<photo-uuid-2>"]}
```

```json
{"sessionCode":"<session-code>","mode":"BASIC","templateId":"sci-fi-space-commander-001"}
```

```json
{"sessionCode":"<session-code>","mode":"ADVANCED","experienceId":"mini-me"}
```

Omitted IDs use `BASIC_TEMPLATE_ID` / `ADVANCED_EXPERIENCE_ID`, retaining compatibility
with existing BASIC/ADVANCED clients. A mismatched template/experience mode is rejected.
GET `/api/v1/experiences` returns `{data:[{id,name,description}]}`; prompts and model IDs
are server-only. The 44 built-in presets were imported from the original
`PhBo/backend/app/experiences.py`, including their prompt suffix and model.
Managed database overrides from the old deployment are not imported by this script.

The job stores the requested IDs and an engine snapshot. BASIC stores its template ID,
derived internal prompt, and server-selected model; ADVANCED stores the selected
prompt/model. Later registry edits cannot change queued jobs. The AI provider and model
are never customer choices.

## 4R image dimensions

The registered Basic template PNG is 1024×1536 (2:3). At 4R portrait size (4×6 in),
that is 256 pixels per inch; 1200×1800 is needed for 300 ppi. The generated AI result
is normalized to 2160×3240 (2:3), enough pixels for 4R, but the PNG does not embed a
print DPI. The print flow must scale it to 4×6 in. Basic generation uses the registered
template name/description as prompt direction; it does not paste the 1024×1536 PNG into
the generated result.

## Setup

Apply the additive migration and regenerate the client before starting API/worker:

```powershell
pnpm db:generate
pnpm db:migrate
```

The private image helper uses Python 3.12, Pillow, FastAPI, python-multipart, and
uvicorn for upload normalization, print formatting, and Classic composition only.
Install with `python -m pip install -r python-worker/requirements-classic-api.txt`.
It does not run the BASIC face-fitting engine. BASIC and ADVANCED image-generation
requests go from the TypeScript worker through the `NativeAIProvider` interface.

Example from this backend directory after installing the image-helper dependencies:

```powershell
$env:PYTHONPATH = 'D:\projects\PhBo\backend'
$env:TEMPLATES_DIR = 'D:\projects\PhBo\templates'
$env:AI_ENGINE_API_KEY = '<same secret as backend AI_ENGINE_API_KEY>'
python -m uvicorn basic_api:api --app-dir python-worker --host 127.0.0.1 --port 8001 --limit-concurrency 2
```

Configure the native Express migration entrypoint environment:

```dotenv
IMAGE_ENGINE_BASE_URL=http://127.0.0.1:8001
AI_ENGINE_API_KEY=<shared-secret>
AI_PROVIDER=9router
BASIC_MODEL_EXPERIENCE_ID=mini-me
NINEROUTER_BASE_URL=https://your-gateway/v1
NINEROUTER_API_KEY=<provider-key>
NINEROUTER_TIMEOUT_SECONDS=90
WORKER_LEASE_SECONDS=120
```

The Basic model setting must point to an enabled, published experience row so the
server can resolve its configured image model. The private image helper receives
Bearer auth. For containers, use private service addresses instead of loopback and
mount the image-helper modules read-only. The existing Compose file does not start
this separate Python process automatically.

NineRouter receives the `/images/generations` JSON contract: server-selected model,
server-owned prompt, 1024x1024, n=1, b64_json, and the user image normalized to JPEG quality 92 with
longest side at most 1536. JSON/base64, SSE, and trusted URL responses are supported.
Output is decoded and normalized to PNG; missing/corrupt images fail the job.
For external image CDN URLs, set `NINEROUTER_RESULT_ORIGINS` to explicitly trusted
origins. Redirects are rejected; gateway credentials are never attached to image downloads.

The HTTP timeout must remain shorter than the worker lease with enough margin for
image processing/storage. Existing expired-lease retry behavior is retained; a timeout
can still mean the upstream request was billed. No new automatic provider retries were added.

Historical jobs without snapshots resolve the configured defaults. Drain old jobs before
switching deployments if preserving their former routing is necessary.

## Verification

`pnpm test` includes request validation, session/frame regressions, routing, snapshot
stability, AI-only Basic and Advanced dispatch, credit reservation/refund, JPEG payload
normalization, SSE, and corrupt/empty response rejection. Provider HTTP and Python
helper calls use test doubles. Paid NineRouter generation and the PostgreSQL/MinIO
integration suite require their isolated runtimes and credentials; no live paid request
is part of routine validation.
