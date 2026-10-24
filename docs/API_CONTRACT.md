# Photobooth API contract — Sprint 2 mode foundation

## NXDuet implementation (not deployed)

The separate account-owned companion-template API is specified in
[`NXDUET_API.md`](NXDUET_API.md). Creation reserves 100 AI Credit and automatically
saves valid completed templates. Existing modes and their endpoints are unchanged.
Routes are feature-gated; the SQL draft has not been applied to production.

## Current Express Classic event contract (2026-10-10)

Production uses `backend-express/src/migration-app.ts`; historical mode notes
below describe earlier versions. The following Classic contract applies to the
website, authenticated web kiosk, and native kiosk.

`GET /api/classic/layouts` and `/api/kiosk/web/classic/layouts` expose
`requires_event_name: true` for reviewed layouts whose server-owned
`layout_config_json.event_personalization` is `true`. The existing floral ID
remains compatible. Each revised layout has `shot_count: 3` and a sample
`preview_url`. The blank processing overlay contains NXBooth branding but no
event name, date, or QR. Native `GET /api/kiosk/frames` includes these layouts.

`POST /api/generations` and `/api/kiosk/web/generations` accept
`{mode: "CLASSIC", layout_id, upload_id, capture_upload_ids, event_name, captured_at}`.
The first upload must match `upload_id`; exactly three distinct owned captures
are required for these layouts. `event_name` is trimmed/NFC-normalized, 1–80
characters, with control characters rejected. `captured_at` is an ISO timestamp
with timezone, captured when the first accepted photo is taken. It must fall
within one hour before, or one minute after, the first upload creation time.
If omitted, the server uses the first upload time. The event name is required
before generation; these fields are rejected for non-personalized Classic layouts. Native generation uses the corresponding camelCase fields
`eventName` and `capturedAt` alongside `frameId` and `photoIds`.

Basic and Advanced (web only, not kiosk-event jobs) accept the same optional
`event_name` and `captured_at` on `POST /api/generations`. The name is optional;
when it is omitted the footer shows only the date. Every web Basic/Advanced job
freezes a footer personalization (`event_name?`, `captured_at`, `claim_token`) in
its snapshot, and the result always carries a QR for `/r/<claim_token>`. The server owns footer lettering and the QR: after generation the image helper
(`POST /add-result-footer`, `python-worker/result_footer.py`) draws name, WIB
date and QR deterministically with the bundled fonts, without changing the image
size (Basic stays the template size, Advanced stays 2160 × 3240). If the footer
cannot be rendered the job fails and the credit is refunded; a result without its
QR is never delivered. The claim is created atomically with the result and reused
by `POST /api/results/{id}/claim`, so the printed QR keeps working. Printed claims expire with the result’s frozen
package retention; they are not shortened to `RESULT_CLAIM_TTL_HOURS` (24 hours
by default), which still bounds non-embedded share claims.

Python adds the event name with bundled Great Vibes, the WIB date with bundled
Cormorant Garamond, and a secure QR for that specific result. Preview and output
use the same fonts and renderer. The result stays exactly 1200 × 3600 px at
600 DPI; the print rendition stays 600 × 1800 px at 300 DPI. The embedded claim
expires after 14 days and is revoked when the result is deleted. Existing
wallet behavior and AI generation are unchanged by the template revision.

The existing `/api` contract stays in place. Both modes use the same upload,
job queue, polling, result and download endpoints. Client code lives in
`frontend/src/api.js`, request/response schemas in `backend/app/schemas.py`.

| Request | Response | Purpose |
| --- | --- | --- |
| `GET /api/health` | `200` with dependency checks | Service readiness. `ai_provider_connected` only checks credentials/configuration, not live generation. |
| `GET /api/templates` | `200 {templates, count}` | Customer-safe Basic catalog. `preview_url` points only to an Admin-managed marketing preview; a missing preview returns `null` and never falls back to the processing asset. |
| `POST /api/uploads` (multipart `file`) | `201 {upload_id, normalized_content_type, validation_status, preview_url, expires_at, ...}` | Decode JPEG/PNG/WebP/HEIC/HEIF from bytes, apply orientation, normalize to temporary JPEG/sRGB, then store under the current guest/account owner. |
| `GET /api/uploads/{upload_id}` | `200 {upload_id, preview_url, expires_at, ...}` | Restore metadata for the current owner; `404` means unavailable and `410 UPLOAD_EXPIRED` means temporary retention elapsed. |
| `GET /api/uploads/{upload_id}/preview` | image bytes | Owner-checked private preview with `Cache-Control: no-store`. |
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

## Duitku Sandbox payments (prepared 2026-10-17; not deployed)

Requires approved additive SQL `023_duitku_sandbox_payments.sql`, private server
credentials and `DUITKU_ENABLED=true`. Default disabled returns 503
`PAYMENT_GATEWAY_UNAVAILABLE` before any payment writes. Sandbox-only, fixed Rp100
per credit; Sandbox settlement never changes spendable production credit.
See `docs/DUITKU_SANDBOX.md` for deployment/acceptance gates.

| Method/path | Authorization | Input / result |
| --- | --- | --- |
| POST `/api/account/topups/checkout` | Customer account | Strict `{credits: integer 1..100000}`; optional `Idempotency-Key` 16–128 alphanumeric/`_`/`-`; clients reuse it for retry. Returns `{id, merchant_order_id, environment:'sandbox', credits, amount_rupiah, status, reference, expires_at, checkout_url, ...timestamps}`. URL is a server-created HTTPS Sandbox checkout. |
| GET `/api/account/topups` | Customer account | `page`, `page_size` (max100), optional `status`, `search`; owned rows only; `{transactions,total,page,page_size,sandbox_balance,enabled,environment,message,...}`. No customer email/internal request key/checkout URL in history. |
| GET `/api/account/topups/:id` | Owning account | Saved transaction detail; unknown/other owner →404. Does not contact Duitku or trust query status. |
| POST `/api/account/topups/:id/refresh` | Owning account | Authenticated provider status check; saved public transaction detail. Per-order cooldown 30s →429 `PAYMENT_CHECK_RATE_LIMITED`. |
| POST `/api/payments/duitku/callback` | Valid merchant HMAC-SHA256 | Form-urlencoded merchantCode, amount, merchantOrderId, reference, signature, resultCode. Verifies amount/reference and server-to-server status; success/duplicate settled callback →200 plain `OK`. Invalid signature →403; mismatch →409; unavailable verification →502; busy/cooldown →429 (Duitku retries; manual reconciliation also available). |
| GET `/api/admin/payments/config` | Operator/superadmin | Only safe enabled/environment/price/limit/message; never credentials. |
| GET `/api/admin/payments` | Operator/superadmin | Paginated/filterable transactions with existing account email/account ID joined. |
| GET `/api/admin/payments/:id` | Operator/superadmin | Transaction detail with sanitized error/timestamps, no provider payloads or keys. |
| POST `/api/admin/payments/:id/refresh` | Operator/superadmin | Audited request to verify authoritative provider status; no manual mark-paid. |

States: `CREATING`, `PENDING`, `PAID`, `FAILED`, `EXPIRED`. Server calculates amount;
client price/status are never trusted. Provider failure retains the original
order for retry. 409 `IDEMPOTENCY_CONFLICT` rejects changing credits under the same
key; 409 `PAYMENT_IN_PROGRESS` means invoice creation is leased. `PAID` is monotonic;
verified late success is accepted. Customer and Admin writes retain existing
origin checks; body size/rate/cooldown limits apply.

The static `/payment-return.html?order_id=<32-hex-id>` is the invoice return URL
for both UI bundles. It uses the signed-in customer's owned-order API; return
query/JS callback do not settle payment. Frontend callers are in
`frontend/src/api.js`; old and enhanced account UIs share payment components.

## Subscription v2 (prepared 2026-10-18; not active in production)

The coordinated, feature-flagged contract for dual wallets, subscription SKU
checkout, generation lanes and Superadmin API route management is documented in
[SUBSCRIPTION_V2.md](SUBSCRIPTION_V2.md#api-changes). Do not assume these additions
are live before approved migration 024 and coordinated API/worker/web activation.
Existing Sandbox payment callbacks still never grant production entitlements.

## Public API v1 (integration keys) — Storage/key management and Standard generation live

Proposal and decisions: `docs/PUBLIC_API_PROPOSAL.md`. Mounted only when `PUBLIC_API_KEY_PEPPER` (>= 32 chars) is set and additive SQL `backend/migrations/025_public_api_keys.sql` has been applied with approval. Base `/api/public/v1`; independent of cookie `/api/*` and kiosk `/api/v1`. Auth `Authorization: Bearer nxb_live_<id>_<secret>`. Errors use the existing `{ "detail": { "error_code", "message" } }` shape. Responses are `private, no-store`. Rate limit per key: 120/min reads, 20/min uploads and generations when enabled (`429` + `Retry-After`). Upload/generation routes now require `PUBLIC_API_GENERATION_ENABLED=true` (default false).

| Method | Path | Scope | Notes |
| --- | --- | --- | --- |
| GET | `/templates`, `/templates/{id}` | `catalog:read` | enabled BASIC templates with registered assets; `credit_cost` is 50 AI Credit (Standard policy) |
| POST | `/inputs` | `inputs:write` | multipart `file`; returns `input_id`, `content_type`, `size_bytes`, `width`, `height`, `created_at`, `expires_at` |
| POST | `/generations` | `generations:create` | header `Idempotency-Key` required; body `{template_id, input_id, folder_id?}`; `202 {job_id,state,template_id,created_at}`; same key + different body → `409 IDEMPOTENCY_CONFLICT` |
| GET | `/generations/{id}` | `generations:read` | `state`, `result_id`, `error_code`, `credit_charge {status,credits}`; `Retry-After: 3` while not terminal. Never returns provider, model, error text or pricing calculation |
| GET | `/results`, `/results/{id}` | `results:read` | cursor pagination (`limit` 1-50, `next_cursor`); expired results are omitted |
| GET | `/results/{id}/download` | `results:read` | image bytes, attachment |
| GET | `/usage` | `usage:read` | key metadata and daily request/generation counts |

Web-session routes (cookie, not API keys): `GET|POST /api/account/api-keys`, `POST /api/account/api-keys/{id}/rotate` (old key valid 24 h more), `POST /api/account/api-keys/{id}/revoke`. The secret appears only in the create/rotate response. Scopes: `catalog:read`, `inputs:write`, `generations:create`, `generations:read`, `results:read`, `usage:read`. Max 10 active keys per account.

## Photo folders — live, feature gated (SQL026)

`PHOTO_FOLDERS_ENABLED=false` by default. Full endpoint/body/status contracts:
[PHOTO_FOLDERS.md](PHOTO_FOLDERS.md). Owner CRUD/default/move use existing session
cookies under `/api/account/photo-folders`, `/api/account/photos` and
`/api/account/photo-folder-shares`. Generation adds optional `folder_id` (null =
Unfiled, omitted = owner's default), included in request idempotency. Guest/kiosk
cannot select a folder. No folder change rewrites object keys, QR or expiry.

Public live-folder links `/s/:token` use `/api/public/photo-folders/:token` and
share-scoped photo `/image|download` routes; revoked/expired404. Shared payloads
omit owner/internal model details. Owner/API lists enforce paid, non-kiosk,
nondeleted and unexpired results. Key-authenticated read-only REST storage routes
are `/api/public/v1/storage/folders`, `/storage/photos`, and
`/storage/photos/:id/image|download`, requiring `results:read`. They mount only
when Public API is configured AND folder feature enabled. No storage write
endpoint or native S3/IAM provisioning is included in this phase.


### Storage API developer experience — live (2026-10-18)

- `/account?tab=developer`: signed-in key management. UI issues `results:read` with optional `usage:read`, expiration 7/30/90/365 days. Full key appears once after issue/rotate; list contains metadata only. Max 10 active keys is enforced atomically in PostgreSQL, including concurrent creation. Rotate commits the replacement and shortening of the old expiry together; the old expiry is the earlier of its existing expiry or 24 hours. Revocation is immediate for subsequent authentication.
- `/developers`: public documentation and read-only Explorer. Tokens are memory-only, masked, cleared on navigation, never placed in URLs, storage or telemetry. Requests omit cookies, reject redirects and target fixed same-origin GET paths. No automatic authenticated calls. Downloads require the same Bearer header as JSON calls.
- `GET /api/public/v1/capabilities`: public `{enabled,storage,generation,scopes}` activation metadata. `scopes` describes the Storage UI (`results:read`, `usage:read`).
- `GET /api/public/v1/openapi.json`: public OpenAPI 3.1 Storage specification, available while private API is disabled.
- Private Storage endpoints require `results:read`; `GET /usage` requires `usage:read`. Folder/photo lists share the read counter (120/min); media/download/usage impose a stricter 60/min threshold on that counter. Cookie key management is additionally limited to 30/min per IP by the existing limiter.
- SQL025 and PHOTO_FOLDERS_ENABLED are prerequisites for activation. Startup performs a read-only key-schema readiness check. No schema is applied by the app. PUBLIC_API_KEY_PEPPER must be >=32 characters and kept stable privately; changing it invalidates all existing keys. PUBLIC_API_GENERATION_ENABLED stays false for this Storage release.
- Missing/invalid/revoked/expired key: 401. Missing scope/unavailable account: 403. Unowned/unavailable/expired photo: existing result-service 404. Invalid query: 422. Rate exceeded: 429. Storage has no POST/PUT/PATCH/DELETE endpoints. Generation/upload are gated independently; no direct S3/IAM credentials are exposed.


### Generation API — live (2026-10-18)

`PUBLIC_API_GENERATION_ENABLED=true` activates POST `/api/public/v1/inputs`, POST `/api/public/v1/generations`, and GET `/api/public/v1/generations/{id}`. Subscription v2 is required by startup readiness. Owner-approved release generation-api-20261018T151805Z activates generation. No new schema, billing policy, provider or secret is introduced.

- BASIC templates only; Standard lane costs `STANDARD_AI_CREDITS_PER_RESULT` (50 AI Credit). No lane/model/provider/custom-prompt/personalization fields. They return 422. Template DTO `credit_cost` now uses the approved policy constant. Existing website and wallet enforce real availability, ownership, credit reservation/refund, storage quota and result retention.
- Upload: multipart `file`, requires inputs:write. Full existing normalization/validation applies (MIME, dimensions, decode/readability and configured maximum size); response201 contains input_id and expires_at. Upload itself does not spend AI Credit.
- Generate: requires generations:create and Idempotency-Key (1..120 characters), JSON `{input_id,template_id,folder_id?}`. `folder_id` omitted uses account default, null unfiles. Requests map to the actual BASIC service under key-owner identity. Request keys are namespaced `pub_` per account; identical retries reuse the job, changed body conflicts409. Do not invent a new key on a network timeout.
- Status: requires generations:read, actual QUEUED/PROCESSING/COMPLETED/FAILED plus safe error_code and credit_charge status/credits; no upstream errors, prompt/model/provider/cost calculation. Retry-After3 while nonterminal. Read result_id after completion and use existing Storage API with results:read. A creation response202 is not proof that pixels exist; an already terminal retry may require a status GET to retrieve result/refund details.
- Shared write bucket20/min per key for upload+generation. Reads use existing shared read bucket120/min (stricter media/download threshold60/min).
- Capabilities scopes include all six integration scopes when generation enabled. `/openapi.json` then contains Generation+Storage OpenAPI3.1. It remains Storage-only while generation is disabled.
- Account API & Integrasi has an explicit generation permission checkbox (enabled only by capabilities). New keys can opt into catalog:read, inputs:write, generations:create, generations:read in addition to results:read and optional usage:read. Existing keys keep their old permissions, including after rotation; create a new key to add scopes.
- `/developers` adds Generation Explorer: explicitly fetch templates/upload, show local preview, acknowledge50-credit cost, submit once, retry with frozen body and identical key after network failure, query real status manually with3s guidance, download only after COMPLETED+result_id. Secret/input/state live in memory only; no cookies/redirects/telemetry. Definite4xx rejection permits resetting the form; ambiguous network failure preserves request key and body.
- Automated browser results use clearly marked mocks and do not prove provider output. Disposable DB+HTTP tests prove real job/wallet reserve50, idempotency, conflict409, failed-queue refund50 and ownership without production credits or paid AI calls.

### Developer dashboard and per-key generation history — prepared, not live

Cookie-authenticated account endpoints (Bearer keys cannot access them):

- `GET /api/account/api-keys/dashboard?days=7|30|90&key_id=<optional16hex>` returns `{period,selected_key_id,totals,daily,keys,wallet,history_notice}`. Default30 days, full Jakarta calendar days including today. Current account balances/storage come from the existing subscription wallet; period/key filters affect usage/job aggregates, not the account balance. `keys` contains up to50 newest owned keys (including revoked/expired), metadata/counts only. Request counts are existing best-effort authenticated API counters; they include retries and validation failures that passed auth/scope/rate checks and are not billing totals.
- `totals`/`daily`: requests, generation_requests, jobs, completed, failed, queued, processing, credits_spent/reserved/refunded. Job/credit statistics are grouped by job creation date in WIB and reflect current job/charge status. Credits come from actual subscription_v2_jobs: CONSUMED→spent, RESERVED→reserved, REFUNDED→refunded. A refunded charge is reported separately rather than treated as spend. Existing daily request counts can predate per-key job attribution.
- `GET /api/account/api-keys/generations?days=30&key_id=...&state=QUEUED|PROCESSING|COMPLETED|FAILED&limit=20&cursor=...` returns `{generations,next_cursor}`. Limit1..50, newest first cursor(created_at,id). Each job returns job_id, owned key{id,name,prefix}, template_id, state, created_at/finished_at, safe error_code, credit_charge{credits,status}, result_available/result_id/expires_at/download_url. No provider/model/prompt/input image/storage key/secret/hash. CONSUMED maps to public PAID. Download links require current account cookie and are omitted for unpaid, deleted or expired results; ordinary Result ownership/retention is rechecked on download.
- `key_id` must belong to signed-in account, including when revoked: unknown/foreign404. Invalid period/status/key/cursor422. Missing account cookie401, including requests bearing only an API key. Unknown selectors such as account_id are rejected. Responses private,no-store; existing key-management limiter30/min applies.
- Per-key attribution uses existing generation_events, event_type `api_generation_created`, metadata `{key_id}` only. This marker is inserted once in the same transaction as the newly created API job, credit reservation and idempotency record; rollback leaves no partial job/marker/charge. Queue failure remains a recorded job with a refunded reservation. No new schema/table/provider/price rule. Service context is server-supplied, verified against account ownership; customers cannot set it through the generation JSON body.
- Idempotent replay from another key on the same account reuses the original job, keeps original key attribution and creates no second marker/charge. Old keys retain old scopes. Web/Classic/kiosk jobs without the marker are excluded; historical API jobs are not guessed/backfilled from request prefixes. Per-key history starts when this release activates.
- Capabilities adds `dashboard:boolean`; dashboard/history mount only when Public API and subscription wallet are present. Account API & Integrasi renders balances, period/key stats, daily/key tables, status filters, cursor back/next, result downloads, empty/loading/error/refresh states with Indonesian/English copy. Generation/Storage Explorer and key create/rotate/revoke remain available.

### Generation webhooks (candidate, disabled by default)

Requires manually approved additive `027_generation_webhooks.sql` and dedicated encrypted-secret configuration. Existing API-key generation scope/prices are unchanged. Capabilities adds `webhooks:boolean`. Webhook endpoints are cookie-owner management routes; Bearer keys cannot manage configuration/history.

| Method | Path under `/api/account/api-keys/:key` | Contract |
| --- | --- | --- |
| GET | `/webhook` | `{webhook:null\|{id,key_id,url,enabled,events,version,created_at,updated_at}}`; no secret |
| PUT | `/webhook` | Strict body `{url,enabled,events}`; events subset of `generation.completed`, `generation.failed`, at least one. Returns configuration and `signing_secret` **only on first creation** |
| POST | `/webhook/rotate-secret` | Returns one-time `signing_secret`; cancels pending/in-flight delivery leases using old secret |
| GET | `/webhook/deliveries?cursor=&state=` | Newest first20 plus `next_cursor`; states PENDING, IN_FLIGHT, DELIVERED, EXHAUSTED, CANCELLED. No payload, target URL or credentials in history |
| GET | `/webhook/deliveries/:id/attempts` | Latest100 attempt number, HTTP status, safe error category, duration and Jakarta-rendered timestamp |
| POST | `/webhook/deliveries/:id/retry` | 202 `{queued:true}`; owner only, active key/endpoint, same secret version and target URL, DELIVERED/EXHAUSTED, at least60s since last activity and fewer than100 total recorded attempts. Preserves event ID/payload, starts another cycle; no generation or credit charge |

All responses private/no-store. Malformed selectors/body422; no owner cookie401; other-account key/config/history404; unavailable retry409. Existing owner-management rate limit30/minute; unknown JSON/query selectors rejected where filters are supported. URL must use public HTTPS, no credentials/query/fragment/custom port/IP literal/internal hostname. DNS is checked on every attempt; any private/reserved answer rejects delivery, selected public address is pinned at connect, TLS validates original host, redirects/proxies are not followed. No arbitrary receiver response body is read or stored.

Envelope: `{id,type,created_at,api_version:"2026-10-18",data:{job_id,key_id,state,template_id,result_id,error_code,credit_charge:{credits,status}}}`. Result ID appears only for a completed paid result; fetch using existing authenticated Generation/Storage APIs, which enforce deletion/retention. No photo bytes, claim URL, prompt, provider, model or secret. Creation is in the same PostgreSQL terminal-state/credit-settlement transaction. Original job attribution controls destination; a cross-key idempotent retry does not add an event. No historical backfill. Web/Classic jobs without API attribution do not emit events.

Headers: `X-NXBooth-Event-Id`, `X-NXBooth-Timestamp` (integer Unix seconds), `X-NXBooth-Signature: v1=<hex HMAC-SHA256(secret, timestamp+'.'+rawBody)>`. Verify exact raw bytes with constant-time comparison, reject timestamps outside300 seconds, and persist/deduplicate envelope event ID before returning2xx. Automatic retry reuses event ID and immutable payload, signs a fresh attempt timestamp. At-least-once delivery permits duplicates after ambiguous receiver/worker failure. HTTPS2xx acknowledges; non2xx/network/timeout fails. Dispatcher concurrency1, DNS deadline3s plus HTTP deadline7s, expiring60s PostgreSQL lease. Recorded attempt cycle limit5: initial, then1m/5m/30m/2h delays. Failed pre-ack worker crashes can redeliver and are not counted as recorded attempts.

One endpoint per key. `version` identifies signing-secret generation; URL edits affect future events, already queued deliveries retain their original URL. Disabling endpoint, rotating signing secret or revoking key cancels outstanding deliveries; an already in-flight request may have reached receiver. Expired/disabled-account keys are rechecked before dispatch. Manual retry never redirects old payloads to a changed URL; CANCELLED deliveries cannot be retried. Terminal logs are removed in batches200 after30 days since last activity, with attempt rows cascading; pending/in-flight events are retained. Endpoint/key configuration records remain.

Secrets use random256-bit signing material, AES-256-GCM encrypted with endpoint-ID AAD and a separate privately supplied versioned keyring (`WEBHOOK_SECRET_ENCRYPTION_KEY`, JSON version-to64hex), active version `WEBHOOK_SECRET_ENCRYPTION_VERSION`. Keep old encryption keys while any endpoint references them. No API-key hash/session-secret reuse. Missing keyring/schema with feature enabled prevents startup. Default feature off does not access new tables. Changing encryption keyring version does not change receiver signing secrets; rotating a receiver signing secret is an explicit owner operation.
