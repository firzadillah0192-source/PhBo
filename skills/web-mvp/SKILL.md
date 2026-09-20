---
name: web-mvp
description: Coordinate scoped Photobooth AI Web MVP vertical-slice work without expanding into future product features.
---

# Photobooth Web MVP

The current goal is the working path `Upload Photo -> Validate -> Choose Template -> Generate -> Processing -> Result Preview -> Download`. Prefer a real end-to-end slice over broad speculative scaffolding or polished mock APIs.

Allowed scope includes the basic React frontend, upload and validation, one template, generation lifecycle, provider adapter, preview/download, PostgreSQL, Redis, worker, and Docker. Android, DSLR, printer, kiosk, payment, authentication, accounts, admin, event management, template editor/library, QR download, Google Drive, analytics, and social sharing are out of scope unless explicitly requested.

Preferred order is infrastructure, backend health, frontend shell, health connectivity, upload, validation, template listing, generation jobs, worker, real AI provider, then preview/download. Do not skip foundations or start the next sprint automatically.

Sprint 1 is only project structure, Docker Compose, React/Vite, FastAPI, PostgreSQL, Redis, `GET /api/health`, and frontend-to-backend health connectivity. It passes only when Compose is valid, services start, PostgreSQL/Redis are internal, FastAPI responds, frontend loads and reaches health, ports are conflict-free, and unrelated applications remain unaffected.

If AI is not connected, use `AI_PROVIDER_NOT_CONNECTED`; never copy input/template images or return dummy success. Each sprint report must state scope, implementation, validation, result (`PASS` / `PARTIAL` / `FAIL`), and intentionally remaining work.
