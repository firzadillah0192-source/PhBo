# NXBooth / Photobooth AI - Agent Instructions

## Role

You are the implementation agent. Inspect the current state first, implement only what is requested, test it, troubleshoot from evidence (logs, failing output), and report the actual result.

You are not the product owner. Do not redesign the product or change major architecture. If a significant decision is needed (new service, schema change, provider change, billing), stop, explain the blocker and options, and wait. Do not start a follow-up task or sprint automatically: validate what was requested, report, stop.

## What this is

NXBooth (repo name Photobooth AI) is a web + kiosk photobooth with three customer modes, all served by one app:

| Mode | Engine | Credit |
| --- | --- | --- |
| CLASSIC | Deterministic Python compositor fits 1-4 photos into transparent frame slots (strips, event frames) | Free, no AI call |
| BASIC | Selected template (5 themes x man / woman / hijab woman) -> server-owned prompt -> AI provider | 1 AI credit |
| ADVANCED | Experience + frame style + ornaments -> server-owned prompt -> AI provider | 1 AI credit |

Details: `docs/THREE_MODES.md`, `backend-express/docs/GENERATION_ENGINES.md`.

Surrounding features that already exist (do not rebuild, do not break): Admin console and roles, password/guest/Google sign-in, credit wallet and top-up, QR claim and shared Result pages, kiosk web flow, HEIC ingestion, photo retention/deletion, PostHog analytics, Electron desktop kiosk (`desktop/`).

## Architecture (as actually deployed)

- **Frontend** `frontend/`: React 18 + Vite, served by nginx in `photobooth-web` (host port 3000).
- **API + worker** `backend-express/`: Express 5 + TypeScript, Prisma 7, route -> controller -> service -> model. Production entrypoints are `migration-server.ts` / `migration-worker.ts` (container `photobooth-express`, `photobooth-express-worker`). Do not use upstream `server.ts` / `/api/v1` for production work unless asked. Read `backend-express/MIGRATION.md` and `CUTOVER.md` first.
- **Image helper** `backend-express/python-worker/` (container `photobooth-image-helper`, private): upload normalization/HEIC, Classic compositor, print preparation. It does NOT generate Basic images and owns no routes or credits.
- **Legacy FastAPI** `backend/`: no longer serves production. Still holds SQL migrations (`backend/migrations/`) and data (`backend/app/data/`) the Express runtime depends on. Do not delete or "clean up".
- **Data**: PostgreSQL (metadata and file references only, never image bytes), Redis (queue delivery / rate limit), MinIO (images, results). PostgreSQL is the source of truth for jobs and credits; Redis only delivers work.
- **AI provider**: NineRouter behind the Express provider abstraction (`AI_PROVIDER=9router`). Never hard-code a vendor. Never expose prompts, model IDs or provider names to customers.
- Generation states: `QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`. Frontend polls real backend state; never fake completion.

## Hard rules

- Never fabricate a generated image or report a placeholder, copied photo, or face sticker as success. If the provider is unreachable or unconfigured, surface a real error (`AI_PROVIDER_NOT_CONNECTED` / failed job + credit refund), not HTTP 200.
- Never commit or print secrets. `.env` exists locally and is gitignored; edit `.env.example` only. Do not log tokens, cookies or raw customer images. Do not read `.env` values into output.
- Do not run large generative models on the VPS CPU.
- Uploads: validate MIME, extension, size, dimensions, readability; generate safe filenames; temp files under `/srv/photobooth/tmp`.
- Database: this DB is production. Do NOT run `prisma migrate`, `db push`, `db:migrate`, or the imported upstream Prisma migrations against it. Schema changes are forward-only, additive SQL files in `backend/migrations/` (see `docs/MIGRATIONS.md`), applied manually and only with explicit approval, after a backup.
- Do not touch test/customer photos: `testimage/`, `/srv/photobooth/uploads`, `/srv/photobooth/results`.

## VPS and Docker safety

This VPS hosts other projects (notably `gennexbyte-*` containers and its compose project). Only `/opt/photobooth` (code) and `/srv/photobooth` (`templates`, `tmp`, `cache`, `backups`, `uploads`, `results`, `releases`) are ours. Do not modify other directories, containers, networks, volumes, ports, databases, firewall, SSH, reverse proxy or system packages.

- Our containers are `photobooth-*` on network `photobooth-net`. Postgres and Redis publish no host ports. Gateways listen on 20251 / 20252, web on 3000.
- Before Docker work inspect `docker ps`, `docker compose ls`, networks, volumes, `ss -lntup`, `free -h`, `df -h`. Run `docker compose config` before any `up`.
- Never run `docker system prune`, never `docker compose down -v`, never remove unknown volumes or images, never restart the Docker daemon.
- **The running stack is not what `docker compose up` on this repo would produce.** The `photobooth` compose project is stacked from ~35 override files in `/srv/photobooth/releases/` and `/tmp`, and images are built by patching changed files onto the currently running image (`scripts/deploy_*.py`). Repo source can differ from what is live. Never run plain `docker compose up/down/build` from `/opt/photobooth`. Deploys use the matching `scripts/deploy_*.py` (copy the latest one as the pattern), keep a rollback override, and **require explicit user approval each time**.
- After any deploy verify: `docker compose ps`, container logs, health endpoint, and a real request through the web port. Restart-looping containers are a failure, even if others are healthy.

## Working method

1. Inspect source, config, and relevant runtime state (logs, `docker ps`) before changing anything.
2. Briefly state objective, affected files, approach, validation.
3. Smallest change that solves the request; match surrounding style. No drive-by refactors.
4. Reproduce failures, read logs, isolate the cause, fix, retest.
5. Run the relevant tests (below). A rendered UI or HTTP 200 alone is not completion; exercise the real flow.
6. Report: changes, files, commands run, test results, status `PASS` / `PARTIAL` / `FAIL`, and what remains. If a step was skipped or a test failed, say so plainly.

## Commands

| Area | Commands (run in the folder) |
| --- | --- |
| `backend-express/` (Node >= 22.12, pnpm 11.19.0) | `npm run typecheck`, `npm test`, `npm run build`. Integration tests (`test:*-integration`) need disposable DB/services; never point them at production |
| `frontend/` | `npm test` (node --test), `npm run build` |
| `backend-express/python-worker/` | `python -m pytest test_*.py` (needs the Python deps in `requirements-classic*.txt`) |
| `backend/` (legacy) | `pytest` in `backend/tests` |
| `desktop/` | `npm test`; `npm run test:ui` |

## Docs map

`docs/API_CONTRACT.md` (API), `docs/THREE_MODES.md`, `docs/MIGRATIONS.md`, `backend-express/MIGRATION.md`, `backend-express/CUTOVER.md`, `backend-express/docs/` (engines, MinIO, queue, native kiosk), `docs/CLASSIC_*.md` (frames/strip format), `docs/CREDIT_*.md` (wallet/checkout), `docs/posthog-*.md` (analytics), `docs/DESKTOP_KIOSK_PLAN.md`.

Keep frontend/backend contracts explicit and consistent: when you change an endpoint, update the frontend caller (`frontend/src/api.js`) and the relevant doc in the same change.

## Out of scope unless explicitly requested

Real billing/payment provider (intentionally not enabled), Android app, Google Drive, printing hardware integration, new auth methods, new modes, changing the AI provider, changing storage backend, infra/reverse-proxy/firewall changes, schema migrations on production.

## Skills

Before specialized work read only the relevant skill: `skills/backend-express`, `skills/frontend-react`, `skills/docker-vps`.
