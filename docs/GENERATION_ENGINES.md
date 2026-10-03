# Generation engine integration

The existing Express flow remains kiosk upload -> photo session -> browser claim ->
PostgreSQL queue -> Node worker -> MinIO result -> polling. Photo session credentials and expiry are stored in PostgreSQL. Frames CRUD, its model, image validation, and compositing code are unchanged.

| Mode | Engine | Existing quota policy |
| --- | --- | --- |
| CLASSIC | Python compositor, 1–4 photos fitted to transparent frame slots | Unlimited |
| BASIC | Original PhBo Python face-fitting engine | Shared session quota |
| ADVANCED | NineRouter, called directly by the TypeScript worker | Shared session quota |

CLASSIC accepts 1–4 photos. A frame is required when selecting multiple photos;
one photo without a frame returns the original as PNG. `frameId` is validated as
active. CLASSIC rejects `templateId` and does not run BASIC face fitting.

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

The job stores the requested IDs and an engine snapshot. ADVANCED stores the selected
prompt/model; later registry edits cannot change queued jobs. BASIC stores its template
ID; keep the Python asset deployment unchanged while those jobs drain.

## Setup

Apply the additive migration and regenerate the client before starting API/worker:

```powershell
pnpm db:generate
pnpm db:migrate
```

For BASIC, run the bridge in an environment that already supports the original
PhBo engine. The bridge imports the original code directly, never its generation service
or SQLAlchemy job writer. No edits to the original repository are needed.
Python 3.12 (matching the original Dockerfile) and the original project's dependencies are required; its Dockerfile also
installs MediaPipe 0.10.21. MediaPipe's bundled landmark model and the original template
PNG/JSON are necessary for real output.

CLASSIC alone requires Pillow, FastAPI, python-multipart, and uvicorn.
Install with `python -m pip install -r python-worker/requirements-classic-api.txt`.
Original PhBo imports are lazy and are only needed for BASIC requests. The same bridge
accepts CLASSIC multipart `images` (1–4 files), optional `frame`, `mode=CLASSIC`,
and `generationId`. Frames must contain 1–4 enclosed transparent slots; the
compositor rejects more selected photos than slots. Fewer photos repeat in order.
Restart the Python bridge after deploying these changes.

Example from this backend directory after installing the original runtime dependencies:

```powershell
$env:PYTHONPATH = 'D:\projects\PhBo\backend'
$env:TEMPLATES_DIR = 'D:\projects\PhBo\templates'
$env:AI_ENGINE_API_KEY = '<same secret as backend AI_ENGINE_API_KEY>'
python -m uvicorn basic_api:api --app-dir python-worker --host 127.0.0.1 --port 8001 --limit-concurrency 2
```

Configure the Express environment:

```dotenv
AI_ENGINE_URL=http://127.0.0.1:8001/generate
AI_ENGINE_API_KEY=<shared-secret>
BASIC_TEMPLATE_ID=sci-fi-space-commander-001
ADVANCED_EXPERIENCE_ID=mini-me
NINEROUTER_BASE_URL=https://your-gateway/v1
NINEROUTER_API_KEY=<provider-key>
AI_ENGINE_TIMEOUT_MS=90000
WORKER_LEASE_SECONDS=120
```

For containers, use private service addresses instead of loopback and mount the original
Python backend and template assets read-only. The existing Compose file does not start
this separate Python process automatically. Keep it private; its endpoint requires Bearer auth.

NineRouter receives the original `/images/generations` JSON contract: preset model,
prompt, 1024x1024, n=1, b64_json, and the user image normalized to JPEG quality 92 with
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
stability, JPEG payload normalization, SSE and corrupt/empty response rejection.
Provider HTTP and Python calls use test doubles. Real BASIC inference, paid NineRouter
generation, and the PostgreSQL/MinIO integration suite require their live runtimes.
