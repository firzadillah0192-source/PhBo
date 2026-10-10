# Credit wallet, top ups, and studio selection

Implementation prepared on 2026-10-08 and deployed on 2026-10-09. Release: `/srv/photobooth/releases/credit-checkout-20261009T021554Z`. See `docs/CREDIT_CHECKOUT_DEPLOYMENT.md` for rollout and live verification. Wallets initialize/reset on account activity; checkout remains unavailable. Since the follow-up token-estimate release on 2026-10-09, aggregate input/output is sufficient for an explicitly estimated charge. Complete token categories/cache use detailed pricing when available.

## Agreed behavior

- Customer names: CLASSIC → **Photo Booth**, BASIC → **Scene Remix**, ADVANCED → **Creative Studio**. Persisted mode IDs and existing URLs remain compatible.
- Signed-in accounts receive **50 free credits**. Every 14 days the free allocation resets to 50; missed periods do not accumulate. Reset is applied transactionally on the next account/wallet operation. Dates remain anchored to the original wallet period.
- Additional credits never expire. Existing unspent legacy balances are carried separately into additional credits rather than discarded. This includes existing manual grants and legacy allocations; it is not evidence of a paid purchase.
- Free credits are used before additional credits. Paid/legacy balance is untouched by free resets.
- Photo Booth costs **1 credit for a successful result**.
- AI requires **at least 10 available credits** to start. This minimum is not the price or a guarantee that the final cost is at most 10.
- Starting a generation creates a pending accounting record with zero amount; it does not deduct or hold balance. One customer generation runs at a time for each owner to prevent simultaneous unpaid jobs.
- Once a valid result is stored, AI cost uses reported categories/cache when complete; otherwise the upper admin estimate from separately priced input/output and any reported cache. It is converted at **Rp18,000/USD**, increased by **20%**, divided by **Rp100**, and rounded up once for the complete job. Cached tokens are subtracted from input totals before uncached rates are applied.
- Successful completion, image record, charge, ledger, and wallet updates share the completion transaction. Duplicate requests/completion/status retries cannot charge twice.
- Failed jobs do not spend credits. Legacy already-reserved jobs remain compatible with prior consume/refund accounting.
- If final cost exceeds the balance, the stored result remains protected with `NEEDS_TOP_UP`; the same-window popup requests more credits. No negative balances or uncharged downloads. Revisiting status after an additional credit grant reconciles the original result without regenerating it.
- If neither supported category usage nor valid aggregate input/output is available, the stored result stays protected with `PENDING_USAGE`. The user sees an explicit explanation and can recheck. **No fixed 13/12 price is used. Aggregate estimates are explicitly labeled; total_tokens is never multiplied by one rate.** Additional AI jobs are blocked until pending usage/payment is resolved.

## Top-up interface

Page: `/account?tab=plan` (compatible route, now labeled **Tambah Bekal**).

| Name | Credits | Price |
| --- | ---: | ---: |
| Bekal Saku | 100 | Rp10,000 |
| Bekal Santai | 200 | Rp20,000 |
| Bekal Eksplorasi | 300 | Rp30,000 |
| Bekal Petualangan | 500 | Rp50,000 |
| Bekal Ekspedisi | 1,000 | Rp100,000 |
| Racik Bekalmu | Positive whole number | Credits × Rp100 |

Copy: “Sekali isi, pakai untuk berkarya sampai habis. Tanpa langganan.”

No recurring payments, membership promises, monthly benefits, or purchase-based queue priorities. The proposed per-hour limits from the earlier discussion are **not implemented** as an unconfirmed package policy.

A compact top-up picker opens inside the same window when credit is insufficient. The Bayar button requests `POST /api/account/topups/checkout` with the selected integer `credits`. An authenticated, validated request currently returns HTTP 503 `PAYMENT_GATEWAY_UNAVAILABLE`, without payment or wallet writes. The frontend opens a same-window popup with `mailto:support@gennexbyte.com`. Gateway/network unavailability also uses this fallback. A future successful response `{ checkout_url }` continues to the server-created HTTPS checkout; gateway creation and settlement are not connected yet. The selected package/custom amount survives closing the notice, including when opened over the top-up popup. There is no client endpoint that grants credits based on a selection or a claimed payment. Connecting a payment gateway and verified, idempotent settlement is separate remaining work. Existing audited admin credit adjustments continue to work and are imported into additional balance.

## Mode picker

Each customer mode opens a modal with Back at top left, Close at top right, search first, then a square grid of actual catalog options. Search covers name, description, and category; loading, empty, no-match, broken preview, and retry states are included. Selecting an item resumes the existing capture/art-direction flow. Escape/backdrop close, focus trapping/restoration, inert background, body scroll lock, and mobile internal scrolling are implemented. Saved upload IDs remain in the session when the credit popup closes.

The existing kiosk gallery is retained; mode labels are updated without replacing its capture/session contracts.

## Pricing and provider data

Reference model family: GPT Image 2.5 gateway aliases. No rate is invented for another model family. Reference rates: text input $5/M, cached text $1.25/M, image input $8/M, cached image $2/M, image output $30/M.

Primary reference: https://developers.openai.com/api/docs/guides/image-generation

The current direct image endpoint has no cache discount unless cache usage is explicitly reported. Unsupported/ambiguous cache totals are not guessed into text/image categories. Metadata is read from validated response headers and JSON/SSE body usage; input details and cache fields are preserved in `provider_usage_raw_json`. Header counters take precedence; inconsistent total token counts are excluded.

**Production historical records and the 2026-10-09 real-provider validation only contain aggregate input/output totals.** A representative actual 9Router response with full input text/image usage must be verified before enabling production billing. The real-provider validation returned a valid image and input/output/total counters, but no category split. The parser cannot infer the provider invoice. The follow-up release now uses the agreed upper admin estimate when aggregate counters are available, so these results are charged after success and unlocked. Only absent/invalid usage or unsupported models remain pending. Gateway surcharges/invoices are not included in the reference token calculation.

## Files and rollout prerequisites

- `backend/migrations/021_credit_wallets.sql`: additive `credit_wallets`, `credit_wallet_reservations`, `generation_credit_charges`; preserves existing tables/data.
- `backend-express/src/models/credit-wallet.model.ts`: locked wallet initialization/reset, free-first allocation, reconciliation of existing admin adjustments, compatibility counters.
- `backend-express/src/models/credit-accounting.model.ts`: pending start, minimum check, post-result pricing/settlement, insufficient/unknown usage states.
- `backend-express/src/services/credit-pricing.service.ts`, `generation-credit-charge.service.ts`: token/cache matrix and job price.
- Account, generation, result models/services and provider metadata adapter: wallet API, protected result access, body usage capture.
- `frontend/src/creditCatalog.js`, customer `CreditTopUp`, `StudioModal`, `ModePickerModal`, `CreditTopUpModal`: names, prices, custom validation, accessible popups.
- `App.jsx`, account/nav/review/result screens, home mode cards: integration, minimum 10, receipts, renamed modes.

Before production deployment: validate representative upstream usage; back up the application database; apply the additive migration; ship coordinated API and worker code and frontend from isolated releases that preserve other uncommitted work. This coordinated migration and release was applied on 2026-10-09; prior pre-wallet images lack these changes. A frontend-only deployment cannot activate the wallet correctly. Account quota fields remain compatibility projections; do not delete wallet tables when rolling back or discard post-rollout billing records.

## Validation

- Frontend build PASS; 77 frontend tests PASS.
- Backend production source TypeScript compile PASS; npm suite 118 PASS, 1 existing environment-dependent skip (119 total).
- Real disposable PostgreSQL integration PASS: initial signup 50, concurrent initialization/reset, free-first spending, skipped periods, legacy balances/manual grants, exact minimum 10, zero spend at start, failures, insufficient funds, duplicate settlement, unknown usage and protected result access.
- Actual worker-to-database completion and Express result endpoints PASS using synthetic image/provider fixtures: post-result 9-credit calculation, no duplicate spend, authenticated PNG delivery; pending usage rejects metadata/image/download/claim and hides archive links.
- Existing admin sign-in/roles/delegation/tier assignment integration PASS with wallet tables.
- 14 browser scenarios PASS at 1440, 390, 320px: all 3 mode pickers, search/empty/clear, Back/Escape/focus trap, no overflow, real disposable account API, custom 750 credits → Rp75,000, invalid custom input, no fabricated purchase, 9-credit popup, 10-credit generation allowed.
- Browser report/screenshots: `test/output/credit-wallet/`; browser catalog and generation responses are synthetic fixtures, account/session/wallet API uses the actual Express services and disposable PostgreSQL.
- **0 production balance writes; 0 real provider calls; no payment transaction; no production deployment.**

### Payment availability fallback (2026-10-08)

- Frontend `npm test`: 79 PASS; `npm run build`: PASS.
- Express `npm test`: 120 PASS, 1 environment-dependent skip; production-source `tsc -p tsconfig.build.json`: PASS.
- Checkout HTTP contract uses the actual Express application: signed-in valid selection → 503 `PAYMENT_GATEWAY_UNAVAILABLE`; guest → 401; invalid amount → 422. No payment or wallet mutation is implemented by this endpoint.
- `node frontend/scripts/payment-checkout-browser-check.mjs` (run from repository root): 6 browser scenarios on real components at 1440/390/320px, standalone and nested popup. Tests use mocked checkout responses, including successful redirect; no real gateway is connected. Covers custom amount, disabled loading/invalid input, clickable support email, network failure, auth expiry, focus trap/restoration, Back/Close/Escape and no horizontal overflow. Artifacts: `test/output/payment-checkout/`.
- Full `npm run typecheck` currently FAILS on existing test typing in `credit-wallet.integration.test.ts` (provider metadata/array conversion) and `native-generation-runner.test.ts` (canvas union). Production source compilation and the focused checkout tests pass; those unrelated test typing changes are outside this UI request.
- This change was deployed on 2026-10-09. Gateway integration must replace the unavailable boundary with a server-created `{ checkout_url }` and verified settlement; setting a frontend flag does not connect payments.

### Aggregate-estimate follow-up (2026-10-09)

Deployed release: `/srv/photobooth/releases/token-estimate-20261009T025725Z`. See `docs/TOKEN_ESTIMATE_DEPLOYMENT.md`. Separately price input/output; use reported cache once; aggregate fallback uses the upper admin estimate. Complete category/cache usage retains detailed pricing. Currency/fee/credit unit remain 18,000 / 20% / Rp100. Successful calls are billed; failed calls are excluded. No retroactive repricing of already-paid jobs.
