---
name: backend-express
description: Make small, tested changes to the NXBooth Express/TypeScript API, worker and private Python image helper.
---

# Express Backend

Production runs `backend-express/` via `src/migration-server.ts` and `src/migration-worker.ts` (see `MIGRATION.md`, `CUTOVER.md`). Structure is route -> controller -> service -> model (Prisma). Request schemas are Zod in `src/objects/requests.ts`; public responses in `src/objects/responses.ts`. Use `.js` extensions on relative imports.

Keep API contracts explicit: method, path, input, output, status, error code. Errors are `{ "error": { "code", "message" } }` with meaningful 4xx/5xx; never return 200 for a failure. Update `frontend/src/api.js` and `docs/API_CONTRACT.md` with any contract change.

Generation: states `QUEUED/PROCESSING/COMPLETED/FAILED`; PostgreSQL is authoritative, Redis only delivers; worker leases prevent double settlement. BASIC and ADVANCED reserve one credit and refund on failure; CLASSIC is free and never calls the provider. Prompts, model IDs and provider names stay server-side. Never fabricate a result image.

Python helper (`python-worker/`) only normalizes images, composes Classic strips, and prepares print output; it owns no routes or credits.

Database: production. No Prisma migrate / db push. Schema changes are additive SQL in `backend/migrations/`, applied manually with approval after a backup.

Validate with `npm run typecheck`, `npm test`, `npm run build` in `backend-express/` (plus the Python tests if the helper changed). Integration tests need disposable resources. Do not log secrets, tokens or raw customer images. Report `PASS`/`PARTIAL`/`FAIL`.
