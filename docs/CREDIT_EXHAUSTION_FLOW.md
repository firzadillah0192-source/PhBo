# Credit exhaustion guidance

Status: **PASS — deployed** at https://nxbooth.gennexbyte.com/.

For both Basic and Advanced, a known empty balance disables generation. Guests
see **Sign in / Create account**, opening the existing authentication form.
Signed-in customers see **Upgrade plan**, opening `/account?tab=plan`.
The guest message distinguishes signing into an existing account from the five
complimentary credits supplied to a new account.

If the generation request reports `AI_QUOTA_EXHAUSTED` or HTTP 402, the app
refreshes identity/usage, blocks further attempts, and opens the appropriate
authentication or plan destination. A successful usage refresh with available
credits enables generation again. Photo and selection state survives navigation
and sign-in. Classic remains outside this AI credit gate.

Subscription, billing, plan purchase, and account credit allocation logic were
not changed. The existing plan screen still governs upgrade availability.

Changed implementation files:

- `frontend/src/App.jsx`
- `frontend/src/components/customer/ReviewStage.jsx`
- `frontend/scripts/credit-gate-browser-check.mjs`
- `scripts/deploy_credit_frontend.py`

Validation:

- Workspace `npm test`: 72 passed; `npm run build`: passed.
- Isolated production snapshot: 63 tests passed; build passed.
- Browser acceptance: 16 scenarios passed locally and against the deployed
  frontend, covering Basic/Advanced, guest/account, known empty balance/server
  rejection, desktop/mobile, correct destination, preserved photo, recovery after
  sign-in, and no browser runtime errors or horizontal overflow.
- Browser API responses were intercepted. No real generation, credit charge,
  signup, login, purchase, or subscription mutation was performed by the tests.
- Docker Compose validation passed; only `photobooth-web` was recreated. Existing
  other container IDs, ports, networks, and volumes were retained.
- Frontend container healthy; actual API health reports database, Redis, storage,
  and queue healthy. Recent frontend logs show successful requests.

Commands: `npm test`, `npm run build`,
`node scripts/credit-gate-browser-check.mjs`, then
`NXBOOTH_PREVIEW_URL=https://nxbooth.gennexbyte.com NXBOOTH_CREDIT_OUTPUT=/tmp/nxbooth-credit-live node scripts/credit-gate-browser-check.mjs`.
Release commands: `python3 scripts/deploy_credit_frontend.py prepare`, `build`,
and `deploy`.

Active image: `photobooth-web:credits-20261007T023208Z`.
Release and manifest: `/srv/photobooth/releases/credits-20261007T023208Z`.
Rollback image: `photobooth-web:before-credits-20261007T023208Z`.
Rollback: `python3 scripts/deploy_credit_frontend.py rollback` while
`/tmp/photobooth-credit-release-path` refers to this release.
The persistent manifest also lists the complete Compose file chain and rollback
override for recovery without that temporary pointer.
