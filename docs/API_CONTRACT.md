# Photobooth API contract — Sprint 2 mode foundation

The existing `/api` contract stays in place. Both modes use the same upload,
job queue, polling, result and download endpoints. Client code lives in
`frontend/src/api.js`, request/response schemas in `backend/app/schemas.py`.

| Request | Response | Purpose |
| --- | --- | --- |
| `GET /api/health` | `200` with dependency checks | Service readiness. `ai_provider_connected` only checks credentials/configuration, not live generation. |
| `GET /api/templates` | `200 {templates, count}` | One current sci-fi template. Internal prompts are not sent to the browser; Basic engine cannot use this template yet. |
| `POST /api/uploads` (multipart `file`) | `201 {upload_id, validation_status, preview_url, ...}` | Validate and temporarily store user image. |
| `POST /api/generations` JSON `{upload_id, template_id, mode}` | `202 {job_id, state, upload_id, template_id, mode, created_at}` | Queue a job. `mode` is `BASIC` or `ADVANCED`; omitted means `ADVANCED` for older clients. Other values return `422`. |
| `GET /api/generations/{job_id}` | `200 {job_id, state, mode, upload_id, template_id, error_code, error_message, result_id, ...}` | Poll `QUEUED → PROCESSING → COMPLETED` or `FAILED`. |
| `GET /api/results/{result_id}` | `200` metadata | Only exists for completed jobs. |
| `GET /api/results/{result_id}/image` | `200` image bytes | Preview. |
| `GET /api/results/{result_id}/download` | `200` attachment | Download. |

Basic jobs are accepted by the API and return `BASIC_ENGINE_NOT_CONNECTED` in
the `FAILED` status once the worker processes them. The UI keeps the Generate
Local action disabled while this is true; it never displays a fake result.
Advanced jobs keep using the existing AI provider interface. Without a real
provider they fail with `AI_PROVIDER_NOT_CONNECTED`.

**Current 9Router limitation:** the checked-in adapter sends one data URI and
expects JSON. The successful Phase 0 test used template URL first, user photo
URL second, field `images`, model `cx/gpt-image-2.5`, and SSE with
`data[0].b64_json`. The template reference image and a private temporary image
URL strategy are not in this repository. Treat live Advanced generation as
**DEV / NOT CONNECTED** until that contract has been integrated and tested.

The PostgreSQL mode column is added on startup with a default of `ADVANCED`;
old rows keep their original meaning. The worker is optional in Compose via
the `generation` profile; enabling it is required for jobs to leave `QUEUED`.

## Local verification

```bash
cd backend
../.venv/bin/python -m pytest -q
cd ../frontend
npm ci
npm run build
```

## VPS rollout after review

Run only after the project source at `/opt/photobooth` is updated from the
chosen Git branch. Inspect running containers, ports and volumes first; keep
the existing PostgreSQL volume. From `/opt/photobooth`:

```bash
docker compose config --quiet
docker compose up -d --build photobooth-api photobooth-web
docker compose ps
curl -fsS http://127.0.0.1:8000/api/health
curl -fsS http://127.0.0.1:3000/api/health
```

After checking the active AI configuration, opt in to the worker with
`docker compose --profile generation up -d --build photobooth-worker`. Both
databases remain internal; the worker has no published port. Check its logs
and poll an actual job to confirm a state transition. No live provider request
or real composite has been validated by this sprint.
