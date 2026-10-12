# AI Provider Lab

Admin Console → **AI Provider Lab** (superadmin only). An isolated sandbox for registering, testing,
benchmarking and comparing third-party image APIs. It never changes production routing, models, fallbacks,
credentials, credits or customer records.

## Isolation

- Code: `backend-express/src/lab/` imports nothing from the generation pipeline, credits, customer models,
  queues or `native-provider` (enforced by `test/lab.test.ts`). It shares only admin auth and `admin_audit_log`.
- Data: one table `lab_docs` (`backend/migrations/022_ai_provider_lab.sql`, additive, no foreign keys; **not applied
  yet**, needs backup + owner approval per `docs/MIGRATIONS.md`). Images live on private disk under `<RUNTIME_DIR>/lab/`
  and are served only through `/api/admin/lab/runs/:id/image/:slot` (no public or presigned URLs). Retention default 7 days;
  image files expire, cost/latency/rating metadata is kept.
- Secrets: Lab keys are AES-256-GCM encrypted with `LAB_ENCRYPTION_KEY` (separate from every production secret).
  The API only returns a masked last-4. Without the key, credential saving is refused.
- Spend: Lab spend is tracked in its own records; it does not touch credit wallets or production usage.
- "Mark as Production Candidate" only stores a benchmark snapshot (`production_activated: false`).

## API (`/api/admin/lab`, all superadmin-only, rate-limited)

`overview`, `settings`, `providers` (+ `/:id/credential`, `/:id/test`), `models`, `estimate`, `runs` (multipart:
`payload` JSON + `template`/`reference`/`extra` files), `runs/:id`, `runs/:id/image/:slot`, `runs/:id/rating`,
`compare`, `sessions`, `benchmarks`, `candidates`, `analytics`, `export.csv`, `purge`.

## Paid-run protocol

1. `POST /estimate` returns the estimate (USD, IDR if a fresh rate is set, or **Pricing Unknown**).
2. `POST /runs` must carry `confirm: true` and `confirmed_estimate_usd` equal to the server's recomputed estimate
   (otherwise `LAB_ESTIMATE_CHANGED`). Unknown price needs `acknowledge_unknown_cost`.
3. Budget (per-request ceiling, daily, monthly, unpriced-runs/day) is checked and reserved under a Postgres advisory lock.
   Exceeding needs a written `override_reason` (≥10 chars); overrides are audited. Defaults: $0.25 / $2 / $20.
4. No automatic retries. Timeouts and interrupted runs still count toward spend (provider may bill them).

## Providers

| Type | Adapter | Notes |
| --- | --- | --- |
| `wavespeed` | yes | `POST /api/v3/{model}`, poll `GET /api/v3/predictions/{id}/result`; inputs uploaded via the SDK's media-upload ticket flow. No billing fields are returned, so cost is "estimate only". |
| `openai` | yes | `/v1/images/generations` and `/v1/images/edits` (multipart); token usage → calculated cost. Not yet tested against the live API. |
| `fal` | yes | queue API (`queue.fal.run`). No free credential check; test from the Playground. Not yet tested live. |
| `9router` | yes | OpenAI-style JSON; base URL must equal the deployment's configured gateway origin. Header-reported cost used when present. Not yet tested live. |
| `custom_rest` | registration only | No generic adapter: arbitrary request shapes cannot be executed safely. |

Network policy: HTTPS only, fixed hosts per provider type, no IP literals, DNS result checked at connect time
(blocks private/loopback/link-local), no redirects, credentials only sent to the provider's API host.

## First WaveSpeedAI key

1. Set `LAB_ENCRYPTION_KEY` (16+ random characters) in the express environment and restart express (deploy step, needs owner approval).
2. Apply `022_ai_provider_lab.sql` after a backup.
3. Sign in as superadmin → AI Provider Lab → Providers → Register (`WaveSpeedAI`) → paste the key → Save key → Test connection
   (free, read-only) → tick "Lab enabled".
4. Models & Pricing → "Prefill WaveSpeed qwen-image/edit-plus" → set the price you verified (WaveSpeed docs list $0.02/image
   but note it is reference only) with source and date → Save. Set the USD→IDR rate with source/date.
5. Image Playground → pick the model, upload template + user photo, write the prompt, review the estimate, confirm.

## NXBooth test types (Basic / Advanced)

The Playground and Comparison tabs have a **Test type** selector:

| Type | What the Lab sends (same as production) |
| --- | --- |
| Free test | Your own images and prompt. |
| NXBooth Basic | Chosen Basic template (filter by man / woman / hijab) + customer face. Prompt = `composeBasicPrompt(name, description)`. Images `[template, face]` prepared by the image helper (`prepare-basic-template`, `prepare-basic-identity`). Size = the template canvas. Output finished like production (fit to the template canvas). |
| NXBooth Advanced | Chosen experience + compatible frame style + customer face. Prompt = `composeAdvancedPrompt(experience prompt, frame prompt)`. Face prepared by `prepare-provider`; 1024x1024 request; output passed through `prepare-advanced` (2:3 print master with branding). Ornaments are camera effects and never reach the provider. |

The prompt is server-owned and not editable in scenario mode; it is shown read-only in the result. The raw provider image is
kept next to the finished one. The production model name is shown for reference only. A model can run Basic only if it
accepts at least 2 input images, Advanced at least 1. Comparison runs the same prepared scenario on every selected model.

The bridge (`src/lab-bridge/nx-scenarios.ts`) is read-only: it reuses the prompt composers and the private image helper
but never creates jobs, freezes snapshots, reserves credits or calls the production provider (enforced by `test/lab-scenarios.test.ts`).

## Adding another provider

1. Generic OpenAI-style API on a public HTTPS host: register type **OpenAI-compatible**, set the base URL (include `/v1` if
   needed), add the key and model; no code required.
2. Bespoke API: add `src/lab/adapters/<name>.ts` implementing `LabAdapter` (`testConnection`, `generate` returning
   normalized images, usage and optional reported cost), register it in `adapters/index.ts`, add its fixed API host(s) to
   `PROVIDER_HOSTS` in `net.ts` and the type to the enums (`types.ts`, `service.ts`, provider dropdown). Use `ctx.http`
   only (never `fetch`), poll with `ctx.sleep`, map errors with `failIfBad`, and copy the mocked-HTTP tests in
   `test/lab.test.ts` (submit, poll, failure, rate limit, non-image output) for the new adapter.
