# Desktop kiosk login by account (plan, not implemented)

Status: **IMPLEMENTED in code and tests, NOT DEPLOYED.** Owner approved the plan (lock-PIN option chosen). Release script: `scripts/deploy_desktop_login.py` (prepare/deploy/rollback/status), waiting for the owner's go and for the express snapshot `validate` to be PASS. Replaces the shared kiosk API key and the local staff PIN as the identity of a kiosk PC.

## Goal

Admin decides, per person, who may operate a kiosk PC, can revoke at any time, and every action is attributable. No shared secret stored on kiosk PCs.

## What already exists (reused)

- `admin_users` (id, name, email, role, is_active) with admin console CRUD for `superadmin` (`admin-operations.service.ts`). Roles are exact-match or `superadmin` (`admin-auth.service.ts`), so a new role cannot reach admin pages.
- `auth_sessions` (hashed token id, `account_id`, `admin_user_id`, `admin_role`, `expires_at`) and `AdminAuthModel.login()`.
- Google sign-in verification (`CustomerAccountService.google`) and `admin_audit_log`.
- Redis (already used for queue and rate limiting).
- The web kiosk currently allows exactly one hard-coded email (`bootstrapKioskEmail`).

## Design (no SQL migration)

1. **New role value `kiosk_operator`** in `admin_users.role`. The column is a plain string, and `backend/migrations` defines no CHECK on it (live DB constraints not inspected). Code changes only: the role enums in `admin-operations.service.ts` and `admin-auth.service.ts`, and the role dropdown in the admin console.
2. **Device activation (device-code flow).** Google blocks sign-in inside embedded Electron windows, so the app does not host the Google page.
   - Desktop calls `POST /api/v1/desktop/device/code` and shows a short code (8 chars, 10 min, single use, stored in Redis with TTL, rate limited) plus the activation address.
   - Staff opens that address on any phone or PC, signs in with Google, checks the code and PC name, and approves (`POST /api/kiosk/device/approve`). The approving account must be an active `kiosk_operator` or `superadmin`.
   - Desktop polls `POST /api/v1/desktop/device/token`; on approval it receives a device token **once**. The server stores only its hash as an `auth_sessions` row (`admin_role = kiosk_operator`, sliding expiry about 14 days). The app keeps the token in `safeStorage`.
3. **Using the token.** `Authorization: Bearer <token>` is accepted by the native kiosk routes and `/desktop/update*` in addition to `X-API-Key`. Each request re-checks that the admin user is still `is_active`, so deactivating someone in the admin console cuts off their PCs at the next request. A session list with "revoke this PC" can follow.
4. **Cut over.** After the app uses tokens everywhere, set `KIOSK_API_KEY` empty on the server (already supported: `KIOSK_NOT_CONFIGURED`) and drop the key field from the app.
5. **Audit.** Activation, approval, revocation and each update install write to `admin_audit_log`.

## Desktop changes

- First run: "Masuk" screen with the code instead of PIN setup.
- Staff menu: a guest must not be able to open it. Recommended: after activation, staff set an optional **local lock PIN** that only guards the staff menu (a screen lock, not an identity). Alternative: re-approve by account each time (safer, slower at events). Owner to choose.
- Remove the kiosk key field. `PHBO_KIOSK_API_KEY` stays as a developer override until cutover.
- Keep working offline for capture; generation and update need internet. Expired token: capture still works, processing asks to log in again.

## Other pieces

- Gateway: new routes need allowlist entries in `api-gateway/control.conf` (`desktop/device/code`, `desktop/device/token`), together with the still-pending `desktop/update` edit. Owner approval and a gateway deploy required.
- Web: static activation page (code entry, lookup, approve) in `frontend/public/kiosk-activate.html`, plus the `Kiosk operator` role option in `frontend/src/AdminPage.jsx`. The live site is `frontend/` (v2 lives under `/v2`). `frontend-enhanced/` and Codex's uncommitted `frontend/src/api.js` are not touched.
- The web kiosk's single hard-coded email can later read the same registry. Out of scope here.

## Order of work (each deploy needs explicit approval)

1. Backend: device flow, Bearer acceptance, role value, audit, tests. Key still works.
2. Desktop: login screen, token storage, use token for update and processing, lock PIN. Tests with a fake server.
3. Web activation page and admin role dropdown.
4. Gateway edits and deploy (together with desktop-update).
5. Real device test on the Windows kiosk, then disable the shared key.

## Risks and open items

- Needs internet for first login; token lifetime trades safety against offline events (proposed 14 days sliding).
- The activation page is the static file `frontend/public/kiosk-activate.html` (URL `/kiosk-activate.html`); it needs the staff member to be signed in to NXBooth already (it does not embed Google sign-in). The approval endpoint is cookie-based, so it needs CSRF protection like the admin routes.
- Live schema and Google client configuration for the activation page are unverified.
- Windows behaviour, gateway behaviour and the deploy cannot be tested on this VPS.
