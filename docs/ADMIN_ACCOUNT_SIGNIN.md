# Account-based NXBooth admin sign-in

Admin: https://nxbooth.gennexbyte.com/admin

Status: **PASS — deployed and verified**. API and web are healthy; disposable preview processes and the test PostgreSQL container have been stopped.

## Access and operation

The owner-authorized existing NXBooth account is configured as an active superadmin. Its Google sign-in remains available. The admin page supports **Google**, **email/password**, and **Continue to admin** when already signed in to NXBooth. Password sign-in uses the existing account password; Google-only accounts should use Google. No new password was assigned.

Use **Admin Users** to add an active, registered NXBooth account by email, choose its role, or disable access:

- **Superadmin**: admin management, catalog, user operations, and plan management.
- **Operator**: user/credit operations, generation records, and manual user plan assignment.
- **Content manager**: Classic layouts, Basic templates, Advanced experiences, and styles.

Only superadmins can add or change admins. Role changes and disabled access take effect at the backend on subsequent requests. Duplicate admin emails and unregistered/suspended accounts are rejected. The final active superadmin cannot be disabled or demoted.

Use **Users → user detail → Subscription → Plan → Assign / change** to set a user's tier. Plans are configured under **Subscriptions** by a superadmin. This uses the existing manual plan assignment and auditable credit allocation; payment integration remains deferred. No customer tier or balance was changed in production by this release.

## Contract and implementation

- `POST /api/admin/login`: `{email, password}` for existing account credentials, or `{}` with a verified existing NXBooth account cookie (including Google sign-in).
- `GET /api/admin/me`: verifies the admin session and returns `{authenticated, actor_id, role}`.
- `POST /api/admin/logout`: revokes the server session and clears the cookie.
- Legacy `{token}` login and `x-admin-token` authorization are rejected. Legacy unbound admin sessions do not authorize access.
- Sessions use the existing signed HttpOnly cookie and a hashed server-side session ID, bound to both account and admin registry entry. Active account, active admin, current role, and expiry are checked on each protected request.
- Existing CSRF/origin checks remain in place; admin login has an IP attempt limit. Account passwords keep the existing scrypt hashing/verification. No password or credential is stored in frontend storage.
- Existing tables are reused; no database schema migration or second credential system.

Backend files: `models/admin-auth.model.ts`, `services/admin-auth.service.ts`, `services/admin-operations.service.ts`, `controllers/admin.controller.ts`, `routes/admin.routes.ts` under `backend-express/src`.

Frontend files: `frontend/src/api.js`, `AdminPage.jsx`, `admin-retro.css`, `components/admin/AdminSignInGate.jsx`, and `AdminShell.jsx`.

## Release and validation

Final images:

- `photobooth-express:admin-signin-20261007T075808Z`
- `photobooth-web:admin-signin-20261007T075808Z`

Release snapshot: `/srv/photobooth/releases/admin-signin-20261007T075808Z`.
Only the API and web containers are replaced. Worker, image helper, PostgreSQL, Redis, and other project containers are preserved. Changed backend runtime files and corresponding source are overlaid on the active image; unrelated uncommitted generation/storage changes are excluded.

Validation:

- **73 frontend tests** passed in the isolated production snapshot. Frontend build and backend source TypeScript compilation passed.
- Real disposable PostgreSQL integration passed: password login, verified account/Google session exchange, normal-user rejection, forged/legacy credential rejection, CSRF, live role change/revocation, duplicate/unregistered admin rejection, last-superadmin protection, logout, audit records, tier assignment/credit ledger, and login throttling.
- **7 browser scenarios** passed locally and using the deployed UI with the disposable native Express test API. Includes desktop/mobile login/error/show-password, sign out/reload, role-specific navigation, Google identity fixture, existing-account continuation, actual test-database admin creation and tier assignment. Zero production business writes from browser tests.
- Real public sign-in page, with unmocked Google button loading, shows email/password and Google without a token field.
- Real production rejects the previously configured legacy token as header (401) and login body (422); unauthenticated `/admin/me` returns 401. The authorized owner registry entry was checked as active superadmin without exposing account credentials.
- **16 customer credit cases** passed on the deployed sign-in release with mocked generation/auth requests; no real generation or signup.
- Final API JavaScript matches the release used for the live browser checks byte-for-byte; the final follow-up adds image source consistency and corrects the mobile login background.

The older whole-workspace `npm run typecheck` also includes an unrelated existing `native-generation-runner.test.ts` canvas typing error. Release source compilation excludes test files and passes. No claim is made that a real owner's Google OAuth session was completed by automation: browser Google credentials use a verifier fixture, while production uses the unchanged Google verifier.

Commands:

```sh
python3 scripts/deploy_admin_signin.py prepare
docker exec -i photobooth-express node --input-type=module - OWNER_EMAIL < scripts/provision_admin_account.mjs
python3 scripts/deploy_admin_signin.py deploy
ADMIN_TEST_DATABASE_URL=DISPOSABLE_TEST_DATABASE node --import tsx --test test/admin-signin.integration.test.ts
ADMIN_UI_BASE=https://nxbooth.gennexbyte.com ADMIN_TEST_API_BASE=http://127.0.0.1:5196 node frontend/scripts/admin-signin-browser-check.mjs
```

Tests require a dedicated `nxbooth_express_admin_auth_test` database; they are never run against production. Preview scripts and browser fixture passwords are synthetic test values. The disposable container is removed after validation.

Rollback manifest: `compose.rollback.yml` in the release folder. `python3 scripts/deploy_admin_signin.py rollback` restores the prior API/web images without altering other services. Those prior images already use account sign-in; the pre-sign-in release snapshots remain separately available. The owner registry configuration and audit history are retained.
