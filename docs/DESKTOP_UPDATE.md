# NXBooth Desktop: installer and in-app update

Status at the 17 October 2026 handoff: desktop **1.1.0 published and verified** ([GitHub release](https://github.com/firzadillah0192-source/PhBo/releases/tag/desktop-v1.1.0)). Update/login routes and gateways were deployed by the previous releases. Windows hardware and the new install handover still need validation on the kiosk PC.

## How it works

1. Build `NXBooth-Setup-x.y.z.exe` on Windows (`npm run package:win`; NSIS cannot be built on the Linux VPS, it needs wine). Per-user install, no UAC.
2. (Optional) sign it, see below.
3. Publish: `python3 -I scripts/publish_desktop_update.py <signed installer> --notes "..."` writes the installer and `manifest.json` (version, sha256, size) to `/srv/photobooth/desktop-updates`, which `photobooth-express` already mounts (`/srv/photobooth`). No container change.
4. On the kiosk: Menu staf -> PIN -> **Cek update** -> **Pasang versi x.y.z**. Starting with 1.1.0, the app shows download percentage, downloaded/total MB, and a progress bar, then verification and installation stages. It checks size + sha256 (and the pinned signature, if configured), then runs the installer silently and restarts. A failed check deletes the download and installs nothing. Updates are refused while a photo session is active. The app quits only after the installer emits `spawn`; launch errors leave the app open with an error. Concurrent install requests are rejected.

API (kiosk key `X-API-Key`, same as other native kiosk routes):

| Route | Gateway | Purpose |
| --- | --- | --- |
| `GET /api/v1/desktop/update?current=1.0.0` | control (JSON) | `{update_available, version, size, sha256, notes}` |
| `GET /api/v1/desktop/update/download` | media (bytes) | streams the installer named by the manifest |

> Login is by account (device code). See [DESKTOP_LOGIN_PLAN.md](DESKTOP_LOGIN_PLAN.md). The update routes accept `Authorization: Bearer <device token>` and still accept the legacy `X-API-Key`. Gateway routes are deployed; the configuration excerpt below is reference material.

## First run (no more Start-NXBooth.cmd)

The app shows a sign-in code; staff approve it at `/kiosk-activate.html` with their NXBooth account (admin gives them the `Kiosk operator` role). Afterwards an optional lock PIN (salted scrypt hash in the encrypted credential store) keeps guests out of the staff menu. `PHBO_OPERATOR_PIN` / `PHBO_KIOSK_API_KEY` still override for tests and advanced use.

## Integrity and the optional signature check

By default an update is accepted when it comes from our server over HTTPS with the kiosk key and its size and sha256 match the manifest. No certificate setup is needed. First install shows the Windows SmartScreen warning once ("More info" -> "Run anyway").

Optional hardening, only if wanted later: create a self-signed certificate (`desktop/scripts/New-NXBoothCert.ps1`), trust it on each kiosk (`Trust-NXBoothCert.ps1`, Administrator), sign installers (`Sign-NXBooth.ps1`) and build with `PHBO_UPDATE_SIGNER_THUMBPRINT=<40 hex>`. The app then also requires a `Valid` signature from that exact thumbprint. Not required, and the PowerShell scripts are untested.

## Gateway configuration (deployed)

The gateways answer 404 for unlisted routes. These routes are configured in `api-gateway/`. Any future gateway deployment still requires the owner's explicit approval.

`control.conf`, add `desktop/update` to the JSON route regex:

```diff
-|results/[a-f0-9]{32}(/url|/claim)?)$" {
+|results/[a-f0-9]{32}(/url|/claim)?|desktop/update)$" {
```

`media.conf`, add before the "Compatibility for legacy" block:

```nginx
    # Desktop installer download (kiosk API key checked by the API). Large body, so allow a slow link.
    location = /api/v1/desktop/update/download {
        limit_except GET { deny all; }
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        proxy_pass $photobooth_api;
    }
```

## Remaining validation and release

- Build/publish 1.1.0 after owner approval: commit only the desktop work and these docs, integrate on top of current origin/main, push tag `desktop-v1.1.0` matching `desktop/package.json`, wait for `.github/workflows/desktop-release.yml`, download the installer, then use `scripts/publish_desktop_update.py`. Do not publish an unbuilt installer or reuse the 1.0.1 executable as 1.1.0.
- Validate the 1.1.0 Windows silent install/restart and physical camera/printer on the kiosk PC. Linux unit/UI tests cover progress, integrity checks and the guest flow with test services; they do not prove Windows installation or physical printing.
- Optional signing and `update.verify` (PowerShell `Get-AuthenticodeSignature`) still need Windows validation if signing is enabled.

## Event mode (1.1.0)

Staff configure event name, date, active flag and a mix of Classic/Basic/Advanced selections in Menu staf. `desktop/shared/event.mjs` validates and persists `event.json` locally in Electron userData; no server schema changes. Guest flow: Start -> choose a template only when multiple are configured -> automatic shots with countdown/retake -> real backend processing -> automatic print attempt and result-claim QR -> manual or idle restart. Default timing is 5/4/120 seconds (countdown/retake/result reset). The event date is display-only; Classic receives the event name and actual capture timestamp. See [operator instructions](../desktop/PANDUAN_OPERATOR.md#mode-event-online-v110).

Windows event capture uses the Canon USB SDK introduced in 1.0.2. Non-Windows development uses the browser webcam. Combined event/Canon UI tests passed using mocked SDK IPC; physical camera behavior still needs Windows validation. Automated tests use a fake camera and local fixture services and must never be reported as real AI or physical print success.

### Release 1.1.0 validation, 17 October 2026

Code and release validation: **PASS**. Windows Actions build succeeded; server offers 1.1.0 to 1.0.2, reports 1.1.0 up to date, and the complete media download matches the installer size and SHA-256. Web/API health checks pass. Release source is based on Canon commit `271040e` (1.0.2), with the event and updater changes layered on top. Owner approved commit, release and publication. The main workspace's unrelated changes were excluded by using an isolated worktree.

- `dotnet build native/KioskBridge -c Release`: PASS, 0 warnings/errors.
- `npm run build`: PASS.
- `npm test`: PASS, 33/33. Includes EventStore validation/restart, result-claim restrictions, streaming download progress, partial-file cleanup after interruption, hash/size failures, concurrent install rejection and retry after launch failure.
- `xvfb-run -a npm run test:ui`: PASS.
- `xvfb-run -a npm run test:webcam-ui`: PASS (Electron fake camera, actual JPEG IPC and real non-Windows adapter failure states).
- `xvfb-run -a npm run test:setup-ui`: PASS, including main/preload/React progress display (percentage, MB, verification, installing).
- `xvfb-run -a npm run test:event-ui`: PASS (staff form, automatic capture/retake/process, printer absence, QR, manual and accelerated automatic reset, template picker and event off).
- `npm run test:canon-ui`: PASS (mocked SDK IPC; manual/event preview and capture, retake, disconnect/reconnect, no browser webcam fallback).
- `git diff --check`: PASS.

The earlier `CAMERA_WINDOWS_ONLY` test failure was resolved by rebuilding the changed adapter, without weakening assertions. UI suites run sequentially with a separate test configuration directory to avoid Electron single-instance contention. Commands use `DOTNET_ROOT=/srv/photobooth/tmp/dotnet-sdk/sdk` and `PHBO_DOTNET` pointing to its `dotnet` binary.

Physical Canon/Epson behavior and Windows silent update/restart remain unverified on this Linux VPS. Progress becomes available once the kiosk runs 1.1.0; an app upgrading from 1.0.x still uses its old updater UI for that first download. No backend schema, gateway or container image changes are required for this desktop publication. Publication evidence and rollback manifest belong in `/srv/photobooth/releases/desktop-1.1.0-20261017T104500Z/manifest.json`.

## Camera test and support log (v1.0.1)

`POST /api/v1/desktop/diagnostics` (control gateway, JSON only, <= 32 KB, same kiosk credentials as the update routes, 10 requests/minute). Strict schema (`backend-express/src/services/desktop-diagnostics.service.ts`): app/OS version, device name, device status, camera probe steps (name, ok, ms, short code, short detail, size) and a scrubbed `startup-error.log` tail. Unknown fields are rejected, so photos, tokens and cookies cannot be stored. Reports are appended to `<RUNTIME_DIR>/desktop-diagnostics/YYYY-MM-DD.jsonl` (2 MB/day cap, 30-day retention); no database change.

The desktop side is `camera.probe` in `desktop/native/KioskBridge/CanonProbe.cs` (FC.SDK over WPD/PTP, Windows only; off Windows and in simulated mode it fails with `CAMERA_WINDOWS_ONLY`, never a fake result) plus the staff-menu buttons. Release script: `scripts/deploy_desktop_diagnostics.py prepare|deploy|rollback|status` (express + control gateway only).
