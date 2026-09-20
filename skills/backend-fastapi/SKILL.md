---
name: backend-fastapi
description: Build and validate small, explicit FastAPI backend changes for the Photobooth AI API and worker workflow.
---

# FastAPI Backend

Keep the backend explicit, small, typed where practical, and testable. Use Pydantic request/response models and document method, path, inputs, outputs, statuses, and errors. Keep frontend calls aligned with the actual API.

The health endpoint is `GET /api/health`, returning an explicit service status. Uploads must validate MIME/type, useful extension, size, readability, and safe generated filenames; never trust client filenames or permit traversal. Temporary files belong under `/srv/photobooth/tmp`.

Use PostgreSQL for metadata only, never image binaries. Use Redis only for queue, job state, or transient coordination. Keep AI routes behind an `AIProvider.generate(...)` boundary and return/report `AI_PROVIDER_NOT_CONNECTED` when no provider is configured. Do not return HTTP 200 for failed operations; use meaningful 400/404/413/422/500/503 statuses.

Do not log secrets, tokens, credentials, or raw customer images. Before backend work is `PASS`, verify startup, endpoint contracts, focused tests, and Docker invocation where applicable.
