# NXBooth Desktop: installer and in-app update

Status: **PARTIAL**. Code and tests are done; gateway change, deploy, Windows build and signing are pending (see "Not done").

## How it works

1. Build `NXBooth-Setup-x.y.z.exe` on Windows (`npm run package:win`; NSIS cannot be built on the Linux VPS, it needs wine). Per-user install, no UAC.
2. (Optional) sign it, see below.
3. Publish: `python3 -I scripts/publish_desktop_update.py <signed installer> --notes "..."` writes the installer and `manifest.json` (version, sha256, size) to `/srv/photobooth/desktop-updates`, which `photobooth-express` already mounts (`/srv/photobooth`). No container change.
4. On the kiosk: Menu staf -> PIN -> **Cek update** -> **Pasang versi x.y.z**. The app downloads, checks size + sha256 (and the pinned signature, if configured), then runs the installer silently and restarts. A failed check deletes the download and installs nothing. Updates are refused while a photo session is active.

API (kiosk key `X-API-Key`, same as other native kiosk routes):

| Route | Gateway | Purpose |
| --- | --- | --- |
| `GET /api/v1/desktop/update?current=1.0.0` | control (JSON) | `{update_available, version, size, sha256, notes}` |
| `GET /api/v1/desktop/update/download` | media (bytes) | streams the installer named by the manifest |

> Update: login is now by account (device code), not a shared key or PIN. See [DESKTOP_LOGIN_PLAN.md](DESKTOP_LOGIN_PLAN.md). The update routes accept `Authorization: Bearer <device token>` and still accept the legacy `X-API-Key`. The gateway edit below is applied in `api-gateway/` (plus `desktop/device/(code|token)`) but NOT deployed.

## First run (no more Start-NXBooth.cmd)

The app shows a sign-in code; staff approve it at `/kiosk-activate.html` with their NXBooth account (admin gives them the `Kiosk operator` role). Afterwards an optional lock PIN (salted scrypt hash in the encrypted credential store) keeps guests out of the staff menu. `PHBO_OPERATOR_PIN` / `PHBO_KIOSK_API_KEY` still override for tests and advanced use.

## Integrity and the optional signature check

By default an update is accepted when it comes from our server over HTTPS with the kiosk key and its size and sha256 match the manifest. No certificate setup is needed. First install shows the Windows SmartScreen warning once ("More info" -> "Run anyway").

Optional hardening, only if wanted later: create a self-signed certificate (`desktop/scripts/New-NXBoothCert.ps1`), trust it on each kiosk (`Trust-NXBoothCert.ps1`, Administrator), sign installers (`Sign-NXBooth.ps1`) and build with `PHBO_UPDATE_SIGNER_THUMBPRINT=<40 hex>`. The app then also requires a `Valid` signature from that exact thumbprint. Not required, and the PowerShell scripts are untested.

## Gateway change required (not applied)

The gateways answer 404 for unlisted routes, so these two edits in `api-gateway/` are needed before kiosks can reach the API. They change the reverse proxy, so they need the owner's explicit deploy approval.

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

## Not done

- Deploy (express + gateways + web) via `scripts/deploy_desktop_login.py`; the gateway edits are already in the repo files above.
- Express deploy: `desktopUpdateRoutes` is in `backend-express/src/routes/desktop-update.routes.ts`, wired in `migration-app.ts` / `migration-server.ts`. Needs a normal `scripts/deploy_*.py` release with approval.
- Windows installer build, signing, silent install and `update.verify` (PowerShell `Get-AuthenticodeSignature`) are **untested**; the VPS is Linux. Unit tests cover the logic with a fake bridge.
- A first-time check `GET /api/v1/desktop/update` returns `update_available:false` until something is published.
