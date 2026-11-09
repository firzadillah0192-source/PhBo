# Photobooth API contract — Sprint 2 mode foundation

The existing `/api` contract stays in place. Both modes use the same upload,
job queue, polling, result and download endpoints. Client code lives in
`frontend/src/api.js`, request/response schemas in `backend/app/schemas.py`.

| Request | Response | Purpose |
| --- | --- | --- |
| `GET /api/health` | `200` with dependency checks | Service readiness. `ai_provider_connected` only checks credentials/configuration, not live generation. |
| `GET /api/templates` | `200 {templates, count}` | Customer-safe Basic catalog. `preview_url` points only to an Admin-managed marketing preview; a missing preview returns `null` and never falls back to the processing asset. |
| `POST /api/uploads` (multipart `file`) | `201 {upload_id, validation_status, preview_url, ...}` | Validate and temporarily store user image. |
| `POST /api/generations` JSON `{upload_id, template_id, mode}` | `202 {job_id, state, upload_id, template_id, mode, created_at}` | Queue a job. `mode` is `BASIC` or `ADVANCED`; omitted means `ADVANCED` for older clients. Other values return `422`. |
| `GET /api/generations/{job_id}` | `200 {job_id, state, mode, upload_id, template_id, error_code, error_message, result_id, ...}` | Poll `QUEUED → PROCESSING → COMPLETED` or `FAILED`. |
| `GET /api/results/{result_id}` | `200` metadata | Only exists for completed jobs. |
| `GET /api/results/{result_id}/image` | `200` image bytes | Preview. |
| `GET /api/results/{result_id}/download` | `200` attachment | Download. |

## Advanced experience publication

`GET /api/experiences` is customer-facing and returns only Admin-managed
experiences whose explicit `status` is `published`. `draft` and `disabled`
rows remain available through the protected Admin catalog API but are not
selectable by customers. Public records contain safe discovery metadata only:
id, name, description, category, thumbnail, enabled availability and sort
order; prompts, providers, models and filesystem paths remain private.

The publication migration adds `status` with a default of `draft`, so the
existing seeded catalog is preserved without automatically publishing all
records. The owner must explicitly publish approved experiences from Admin.
`category` is editable catalog metadata and empty categories naturally stay
hidden from the customer gallery.

## Basic template marketing previews

Basic templates keep two separate assets. `image_path` remains the private
processing asset used by the deterministic Basic engine. The optional
`marketing_preview_path` is a customer-safe image managed by Admin and is the
only source used by `GET /api/templates` and its preview endpoint. If it is
missing, the customer receives `preview_url: null` and the UI shows a neutral
branded placeholder.

Protected Admin actions are:

- `POST /api/admin/templates/{template_id}/image` — replace processing asset;
- `POST /api/admin/templates/{template_id}/preview` — replace marketing preview;
- `DELETE /api/admin/templates/{template_id}/preview` — remove marketing preview;
- `GET /api/admin/templates/{template_id}/image` and `/preview` — operator-only previews.

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

Apply the Basic marketing-preview migration after the existing registry and
publication migrations: `001_admin_registry.sql`, `002_usage_auth.sql`,
`003_control_plane.sql`, `004_experience_publication.sql`,
`005_preview_factory.sql`, `006_basic_marketing_preview.sql`, then
`007_publish_initial_experience.sql`. The final migration only publishes the
untouched `mini-me` starter when the public catalog is otherwise empty; it
does not override an existing Admin publication decision.

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

## Security behavior

All browser mutations require a trusted Origin/Referer or acceptable Fetch
Metadata. Rejected requests return `403 CSRF_BLOCKED`. Private upload, generation
and result endpoints return 404 for other owners and unowned legacy records.
Oversized customer photos return 413; mismatched image MIME/format/extension
returns 422. Validation errors do not echo input values. Initial Google linking
to an existing password account requires a session for that account; otherwise
the API returns `409 ACCOUNT_LINK_REQUIRED`. API responses use `no-store`.
See [SECURITY_HARDENING.md](SECURITY_HARDENING.md) for configuration and limitations.
