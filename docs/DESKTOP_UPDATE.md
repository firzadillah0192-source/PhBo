# NXBooth Desktop: installer and in-app update

Status at the 17 October 2026 handoff: **1.0.1 published**; desktop **1.1.0 in development**, not published. Update/login routes and gateways were deployed by the previous releases. Windows hardware and the new install handover still need validation on the kiosk PC.

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

The event handoff was validated with the browser webcam. A separate session started adding Canon SDK capture while these tests were running; the combined Canon source needs a fresh build and test pass after coordination. Automated tests use a fake camera and local fixture services and must never be reported as real AI or physical print success.

### Codex validation handoff, 17 October 2026

Status: **PARTIAL** for the combined working tree. No commit, push, tag, publish or container deployment by this session.

- Implemented update streaming progress (percent/bytes/stages) through main/preload/React, duplicate-install protection and installer spawn error handling. Added unit coverage for partial/interrupted downloads, integrity failures, concurrent installs and launch retry. Windows install/restart remains untested.
- Fixed the event test fixture's forbidden media path. Fixed overlapping state reads overwriting a finished/reset session; only the latest requested state is now rendered. Event reset errors are shown, and capture loops stop on unmount.
- `dotnet build native/KioskBridge -c Release`: PASS (0 warnings/errors) before the separate Canon source changes.
- `npm run build`: PASS before the separate Canon UI changes.
- `npm test`: 32/32 PASS before the separate Canon changes; latest run 32/33 PASS, 1 FAIL (`camera.capture` expected `CAMERA_NOT_CONNECTED`, received `CAMERA_WINDOWS_ONLY` from the adapter being changed in parallel). New updater, EventStore and claim tests passed. Rebuild the adapter and rerun after Canon work is stable; do not weaken the test to hide this failure.
- `xvfb-run -a npm run test:ui`: PASS before the separate Canon UI changes.
- `xvfb-run -a npm run test:event-ui`: PASS including staff form, automatic photos/retake, process, printer absence, QR, manual reset, accelerated automatic reset, multiple templates and event off. Real timing defaults verified separately as 5/4/120 seconds.
- `xvfb-run -a npm run test:setup-ui`: PASS including real IPC delivery of download percent/MB, verification and installing stages. No Windows executable was launched by this UI test.
- `test:webcam-ui`: initial parallel UI run interrupted due to Electron's single-instance lock; rerun UI suites sequentially after the other desktop session finishes. The later parallel setup run was also interrupted, then passed when run sequentially.

Commands used the local SDK (`DOTNET_ROOT` and `PHBO_DOTNET` = `/srv/photobooth/tmp/dotnet-sdk/sdk` and its `dotnet` binary). Coordination message `21dbb19145874fe1a92dd3d03da51105` asks Claude to confirm ownership of `CanonSession.cs`, `Program.cs`, `shared/bridge.mjs`, `src/camera.jsx` and overlapping UI edits. Those new Canon edits are not Codex's work and were preserved. Final combined validation is pending that coordination. Live releases remain the previous desktop 1.0.1 / express desktop-diagnostics / web activation-page releases.

## Camera test and support log (v1.0.1)

`POST /api/v1/desktop/diagnostics` (control gateway, JSON only, <= 32 KB, same kiosk credentials as the update routes, 10 requests/minute). Strict schema (`backend-express/src/services/desktop-diagnostics.service.ts`): app/OS version, device name, device status, camera probe steps (name, ok, ms, short code, short detail, size) and a scrubbed `startup-error.log` tail. Unknown fields are rejected, so photos, tokens and cookies cannot be stored. Reports are appended to `<RUNTIME_DIR>/desktop-diagnostics/YYYY-MM-DD.jsonl` (2 MB/day cap, 30-day retention); no database change.

The desktop side is `camera.probe` in `desktop/native/KioskBridge/CanonProbe.cs` (FC.SDK over WPD/PTP, Windows only; off Windows and in simulated mode it fails with `CAMERA_WINDOWS_ONLY`, never a fake result) plus the staff-menu buttons. Release script: `scripts/deploy_desktop_diagnostics.py prepare|deploy|rollback|status` (express + control gateway only).
