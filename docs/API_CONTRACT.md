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

## Admin Advanced marketing previews

Advanced experience previews are internal catalog assets and do not consume a
customer's AI credits. The Preview Factory uses the `prompt-only` source by
default: it sends no customer upload, canonical source image, logo, named
franchise, or artist imitation instruction to the configured provider. The
worker adds an original-artwork safety guard to the internal experience
direction before calling the provider. The protected single-preview and
generate-missing endpoints keep the existing `202` queued-job contract.

The legacy canonical preview-source endpoints remain available for controlled
operator use, but the Admin UI does not require or upload a source image for
Advanced previews.

Basic jobs are accepted by the API and return `BASIC_ENGINE_NOT_CONNECTED` in
the `FAILED` status once the worker processes them. The UI keeps the Generate
Local action disabled while this is true; it never displays a fake result.
Advanced jobs keep using the existing AI provider interface. Without a real
provider they fail with `AI_PROVIDER_NOT_CONNECTED`.

The 9router adapter supports both modes through the same provider abstraction.
Customer Advanced generations may include the validated user image; Admin
Advanced marketing previews use prompt-only generation and omit the `image`
field entirely. The adapter accepts the OpenAI-compatible JSON/SSE result and
still fails safely when no image bytes are returned.

The PostgreSQL mode column is added on startup with a default of `ADVANCED`;
old rows keep their original meaning. The worker is optional in Compose via
the `generation` profile; enabling it is required for jobs to leave `QUEUED`.

Apply schema migrations manually and forward-only; there is no filename-driven
migration runner. Apply `001_admin_registry.sql`, `002_usage_auth.sql`,
`003_control_plane.sql`, `004_experience_publication.sql`,
`005_preview_factory.sql`, `006_basic_marketing_preview.sql`,
`007_publish_initial_experience.sql`, `008_provider_usage_operations.sql`,
then `009_result_claims.sql`. The numbering is deliberate: provider usage
already owns migration 008. Migration 007 only publishes the untouched
`mini-me` starter when the public catalog is otherwise empty; it does not
override an existing Admin publication decision. See [MIGRATIONS.md](MIGRATIONS.md)
for application behavior and the exact order.

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
