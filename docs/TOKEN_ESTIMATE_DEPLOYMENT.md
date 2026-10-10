# Token estimate correction — 2026-10-09

Status PASS. Deployed to https://nxbooth.gennexbyte.com from `/srv/photobooth/releases/token-estimate-20261009T025725Z`.

The previous release required text/image/cache categories before charging. Admin already had an estimate from aggregate input/output, so this requirement prevented usable AI results unnecessarily. The correction uses the agreed upper admin estimate when categories are unavailable, and retains detailed category pricing when complete.

## Calculation

Input/output are priced separately; `total_tokens` is not a billing rate input. Reported cache is subtracted from input before its discounted rate, never counted twice. With only aggregate counters, the upper estimate treats input/output/cache at image reference rates ($8/$30/$2 per million). Cache not reported receives no discount. Full categories use existing text/image/cache reference rates. This is an estimate, not the gateway invoice.

Successful provider executions are included; failed attempts are excluded. Sum dollar cost first, convert at Rp18,000/USD, add 20%, divide by Rp100 per credit, then ceil once. Exact minimum 10 to start remains. Starting/failing a job does not spend credits. An insufficient final balance still holds the result for top-up. Missing/invalid usage and unsupported models remain protected; absent category details alone no longer holds the result. Prior paid jobs are not repriced.

The API persists calculation basis, estimated flag, contributing run counters and assumptions. Result receipt labels an estimated charge; review text explains estimation. Cache aggregate values survive normalized response/header capture and raw usage storage without a new database column.

## Files

- `backend-express/src/services/generation-credit-charge.service.ts`: detailed/fallback job charge and explicit estimate metadata.
- `backend-express/src/services/image-pricing.service.ts`: shared admin upper estimate and cache discount.
- `backend-express/src/services/credit-pricing.service.ts`, `native-provider.service.ts`, `models/provider-run.model.ts`: preserve reported cache; do not manufacture missing cache as zero.
- Frontend App, ReviewStage, ResultStage: estimated receipt and review copy.
- Unit/integration tests: raw totals, cache, validation, rounding, worker completion and accessible paid result.

## Validation and deployment

- 125 backend tests PASS; 1 existing environment-dependent skip (126 total).
- 10 staged unit/PostgreSQL integration tests PASS. Real worker stores an image fixture, prices the actual previously-observed 9Router aggregate counters 2421 input / 87 output as 5 credits, spends only after success, serves the authenticated result, and cannot spend twice. Fully missing usage remains protected. Test image/provider responses are synthetic; production customer results were not fabricated.
- API and worker production TypeScript compilation PASS. Staged frontend tests/build PASS (89 frontend tests).
- Live deployed calculator read three actual historical provider records: 5675/396 → 13 credits; 5478/310 → 12; 5572/403 → 13. Read-only comparison; no historical charges were changed.
- Real public health endpoint reports `ok`, with database/Redis/storage/queue all `ok`. API/web healthy, worker starts normally, no startup errors observed.
- A concurrent kiosk release was detected before deployment; the deploy stopped without mutations. Frontend was rebased on the newer `photobooth-web:kiosk-flow-20261009T025649Z` snapshot and only three requested hunks were applied. Existing kiosk changes are retained.
- Only web/API/worker containers changed. Other container IDs, network `photobooth-net`, volumes, ports, gateways and co-hosted projects are retained. No schema migration was needed. No jobs were queued/processing before cutover.
- Backup `/srv/photobooth/backups/pre-token-estimate-20261009T025725Z.dump`, mode 0600. Release manifest and rollback Compose are recorded. `python3 scripts/deploy_token_estimate.py rollback` restores previous images; it does not undo subsequent customer activity/charges.
- Disposable test PostgreSQL was removed after verification. No new production provider call/payment transaction was needed for this correction.
