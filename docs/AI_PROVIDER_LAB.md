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
| `9router` | yes | OpenAI-style JSON; registration uses the deployment's configured gateway automatically. Model import reads `/models/image`, not the general `/models` catalog. Header-reported cost used when present. Live generation not yet tested. |
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

### 9Router registration and model selection

Select **9Router (internal gateway)**; the URL field is disabled and registration omits `base_url`, so the server uses `NINEROUTER_BASE_URL` (including its `/v1` prefix). Explicit URLs from API clients still must match the configured gateway origin. Save a **9Router access key**, then use **Test connection**, **Register models**, and **Lab enabled**. OpenAI API keys and OAuth accounts belong in the 9Router dashboard, not the Lab credential field.

Model registration reads the gateway's dedicated image catalog (`GET /v1/models/image`) and keeps its exact model IDs, including names such as `nb/nanobanana-pro`. Missing credentials, HTTP failures, and malformed catalogs are errors, not successful zero-model imports. An empty valid catalog means the gateway lists no image models. Prices remain unknown unless verified; listed models do not prove generation or reference-image support. Select imported models in **Models & Pricing** and **Image Playground**. OAuth/API-key routing separation is not implemented by this registration change.

1. Generic OpenAI-style API on a public HTTPS host: register type **OpenAI-compatible**, set the base URL (include `/v1` if
   needed), add the key and model; no code required.
2. Bespoke API: add `src/lab/adapters/<name>.ts` implementing `LabAdapter` (`testConnection`, `generate` returning
   normalized images, usage and optional reported cost), register it in `adapters/index.ts`, add its fixed API host(s) to
   `PROVIDER_HOSTS` in `net.ts` and the type to the enums (`types.ts`, `service.ts`, provider dropdown). Use `ctx.http`
   only (never `fetch`), poll with `ctx.sleep`, map errors with `failIfBad`, and copy the mocked-HTTP tests in
   `test/lab.test.ts` (submit, poll, failure, rate limit, non-image output) for the new adapter.

## Model testing and cost accounting (WaveSpeedAI)

**Registration.** Providers → *Register candidate models* creates 44 Lab-only models (the full WaveSpeed image catalog: 22 text-to-image, 22 image-editing; see `src/lab/catalog.ts`) without any provider request:
the 8 text-to-image candidates (plus gpt-image-2.5-sunburst/text-to-image outside the queue; queue order 1–8: z-image/turbo, gpt-image-2.5-flare, gpt-image-2, seedream-v5.0-flash,
qwen-image-3.0, seedream-v5.0-pro, nano-banana-2, nano-banana-pro) and 9 image-editing variants (seedream-v5.0-flash/edit,
seedream-v5.0-pro/edit, nano-banana-2/edit, gpt-image-2.5-flare/edit, gpt-image-2.5-sunburst/edit, gpt-image-2/edit, nano-banana-pro/edit, qwen-image-3.0/edit, qwen-image/edit-plus). qwen-image-3.0/edit refuses Basic/Advanced scenario prompts (800-character limit). Schemas (`src/lab/catalog.ts`) were
copied from each model's official page (`https://wavespeed.ai/models/<id>/llms.txt`, checked 2026-10-12). Text-to-image models take no
input images; `enable_sync_mode` / `enable_base64_output` are never exposed. `gpt-image-2.5-flare/edit` documents no image maximum, so it is
limited to 1 input image until verified. Only parameters in the model schema with valid values are sent.

**Price quotation (non-billable).** *Get price quote* calls `POST /api/v3/model/price` with the model id and the complete planned inputs
(prompt, parameters, uploaded image URLs). The quote shows original price, discounted (payable) price, effective discount, USD, IDR (when a
fresh rate is set), the quote time, the exact parameters, and a comparison with the provider's base price. A failed quotation is
**Pricing Unavailable**: no base-price substitution and no generation. Any input change makes the quote stale; the server re-quotes at submit time and
refuses (`LAB_ESTIMATE_CHANGED`) if it differs from what the admin confirmed.

**Generation.** Exactly one submission per confirmed run, never retried. The prediction id is stored as soon as it is returned, then the
supported result endpoint is polled (transient result failures are retried; they are free). A lost/5xx/id-less submit response is
**AMBIGUOUS**: not retried, budget stays reserved, reconcilable through the billing window or resolvable by an admin (audited).
*Re-check result* fetches an output later for timed-out or recovered runs.

**Billing reconciliation.** `POST /api/v3/billings/search` (`prediction_uuids`) after each run (automatic backoff + *Check billing*). States:
Estimated → Pending Billing → Confirmed; also Adjusted (refund records), Review (multiple charges or unknown record types),
Unavailable (no billing access: Developer keys cannot use this endpoint; or no record after 24 h). Duplicate records collapse by uuid.
The Lab budget follows the confirmed charge once known. Estimated vs confirmed difference is shown per run and in the report.

**Tokens.** Stored only when the provider reports them (source recorded); otherwise **N/A**. Never derived from prices.

**Safeguards (server-side, concurrency-safe).** Defaults: $0.15 per test, $1.00/day, $10/month, 1 active paid generation, 1 run per
request (comparison/batch off until raised), no automatic retries, no auto top-up. Overrides need a written reason and are audited.

**One-by-one benchmarking.** Models #1–#8 must be *verified* (needs a successful run with a confirmed billing record) or *blocked* before
the next one can run; editing/registering models is never blocked. **Report** (Comparison & Benchmarks): estimated, confirmed cost, difference, tokens,
latency, success, rating, cost per accepted image, CSV export (no prompts, ids or credentials).

**First Z-Image Turbo test.** Providers → Register candidate models → Models & Pricing (set fx rate + limits) → Image Playground → pick
*Z-Image Turbo*, write a prompt → Get price quote (compare with base price) → Review & generate → confirm → wait → Check billing → rate →
Models & Pricing → One-by-one test queue → Mark verified.


**Per-model adaptation (Basic/Advanced tests).** Adjustments apply only to models that need them; every other model receives the production prompt unchanged:
models with a prompt cap (Qwen Image 2.0 / 3.0: 800 characters) get a condensed Basic prompt with the same directives (Advanced prompts are too long to condense and are
refused); models that name input images differently (Seedream 5.0 Lite "Figure N", MiniMax H3 "<Picture N>") get "Image N" renamed; size-based models get the production
canvas unless the admin sets a size. The run and the quote list every adjustment made.
