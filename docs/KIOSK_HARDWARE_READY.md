# Kiosk camera and printer implementation — 10 October 2026

Status: **PARTIAL overall**. Software validation **PASS**; physical Windows/Canon/Epson acceptance pending. Frontend release **deployed** after explicit user approval. Live health and kiosk asset checks passed through port 3000 and the public HTTPS site; the live Operator printer panel passed at 1440/390/320 px.

## Implemented

- Desktop hardware capture uses the existing browser-camera helper and EOS Webcam Utility, with live view and decoded JPEG validation before IPC persistence. No Canon EDSDK shutter/JPEG-original implementation is claimed.
- Epson L8050 discovery and Windows spooler submission in `desktop/native/KioskBridge/WindowsPrinter.cs`. Classic 1200×3600 or 600×1800 results occupy two 2×6-inch strips on one portrait 4R sheet; AI results fit without crop. Non-borderless/wrong paper settings fail before submission.
- `desktop/shared/printer-service.mjs` shares a persistent result-ID print journal between Desktop and browser. Loopback port 20253, exact web Origin/Host, operator-only pairing, bounded image payloads and fixed profiles. No new VPS service/port/schema is needed.
- `frontend/src/kioskPrinter.js`, `components/kiosk/useKioskPrinter.js`, `KioskPreview.jsx` and its CSS add pairing and a retro print action. Browser reads only its authenticated kiosk result image. Uncertain outcomes lock repeat submission; accepted means sent to spooler, never confirmed paper output.
- Portable Windows x64 ZIP includes the self-contained .NET bridge, launcher and operator guide: `desktop/release/NXBooth Desktop-0.1.0-win.zip`. See [Windows setup](../desktop/WINDOWS_SETUP.md).

## Validation

| Command / flow | Result |
| --- | --- |
| `dotnet build native/KioskBridge -c Release` using portable SDK | PASS, zero warnings/errors |
| Desktop `npm test` | PASS, 14 tests: recovery, backend fixtures, real .NET simulation, layout, local API checks and print deduplication |
| Desktop `npm run build` and `npm run package:win` | PASS; ZIP integrity, Windows executable signatures and included runtime checked |
| `xvfb-run -a npm run test:ui` | PASS, actual Electron sandbox, PIN, simulated capture and backend error |
| `xvfb-run -a npm run test:webcam-ui` | PASS, actual Electron webcam with Chromium fake test camera, validated JPEG IPC, operator-only pairing and real .NET device status |
| Frontend `npm test` / `npm run build` | PASS, 103 workspace tests; staged live-source release 101 tests |
| `node scripts/kiosk-printer-browser-check.mjs` | PASS at 1440/390/320 px; actual local service + .NET simulation, pairing, print, reload deduplication and lost-response reconciliation; backend HTTP fixtures |
| Personalized `node scripts/kiosk-flow-check.mjs` against staged build | PASS at all three widths; sign in, three modes, event before camera, retakes, generation states, QR/retry, reload and revoked access; backend HTTP fixtures |
| `python3 scripts/deploy_kiosk_printer.py prepare` | PASS, image build and inherited Compose config; no running containers changed |

Logs and package validation: `/srv/photobooth/tmp/dotnet-sdk/`, `/srv/photobooth/tmp/kiosk-printer-*.log`. Staged release: `/srv/photobooth/releases/kiosk-printer-20261010T130035Z` with manifest, build/test logs and rollback override.

Production photos/jobs/credits were not used for these tests. Camera/driver compatibility references are in the operator guide. The tests do **not** prove Windows local-network permission, actual Canon video quality, Epson driver borderless geometry, ink/paper output, or production Desktop credentials. Those require the user's Windows PC and physical devices. Desktop generation continues to require its existing kiosk API credential; browser continues to use web sign in.

Approved deploy completed with `python3 scripts/deploy_kiosk_printer.py deploy`. Only `photobooth-web` changed; healthy, zero restarts. Rollback: same script with `rollback`. Afterwards check Compose status, container logs, health and real web-port requests; browser print acceptance remains a Windows hardware task.
