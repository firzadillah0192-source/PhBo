# Canon USB capture: desktop 1.0.2

Windows desktop photo sessions now use the bundled FC.SDK 3.2.1021 over WPD/PTP for both live view and shutter/JPEG transfer. This is the same USB integration used by the staff camera probe. No Canon EDSDK DLL, .NET SDK installation or EOS Webcam Utility is required for this path. The runtime is bundled in the Windows installer. Close other camera applications, turn the camera on, connect a USB data cable and select JPEG capture on the camera.

Internal adapter commands: `camera.open`, `camera.frame` (bounded preview JPEG data URL), `camera.capture` (safe capture ID -> predetermined JPEG asset path) and `camera.close`. Electron exposes `cameraOpen`, `cameraFrame`, `cameraClose` and the existing `capture`. Windows rejects `captureWebcam`; a failed USB connection never switches to a webcam. The staff probe closes any earlier USB session before testing.

The session opens on the capture screen and closes when leaving it. Preview pauses for shutter and restarts on the next frame. A photo is recorded only after a real JPEG has transferred, passed the existing image checks and been saved. Retake opens the capture screen again. Preview disconnects disable capture and offer **Sambungkan ulang kamera**. A shutter/transfer failure is surfaced; it is not automatically repeated, since a timeout can follow a real shutter.

The non-Windows development path keeps browser webcam capture. Simulation remains explicit and cannot be enabled by the customer renderer. Preview frames are kept in memory, not written to logs or support reports.

Validation: .NET build, desktop unit tests, real Electron simulation/webcam regressions and a browser test of SDK-only preview/capture/retake/disconnect with mocked IPC. These do not establish physical Windows camera acceptance. After installing 1.0.2 on the kiosk, verify USB preview, shutter/JPEG, multiple Classic poses, retake, disconnect/reconnect and then send a fresh support report.

Release scope: 1.0.2 is built from `origin/main` f999214 plus this camera fix. The shared workspace's unreleased 1.1.0 event/updater changes are excluded from this installer; the event source in the shared workspace also uses the new camera hook and stops on capture failure.

Desktop 1.1.0 retains this Canon integration and adds event mode and updater progress. Combined manual/event SDK UI regression tests pass with mocked IPC. Physical Windows acceptance remains pending.

## Camera settings and output size (1.2.0)

Measured on the EOS 2000D with probe 1.1.4/1.1.5 (24 Oct 2026): FC.SDK exposes `GetISO/SetISO`, `GetAperture/SetAperture`, `GetShutterSpeed/SetShutterSpeed`, `SetWhiteBalance`, `GetAEMode`. ISO `D103` reported the allowed values `0, 48, 50, 58, 60, 68, 70, 78` (Auto, 100 to 6400, the `EdsISOSpeed` codes). The image format property `D120` is a structured value (two entries, both Large, fine/normal compression) and `SetProperty` takes a single `UInt32`, so the camera's own JPEG size is not changed.

- Staff menu > **Pengaturan kamera**: ISO, aperture (f/), shutter speed and output size. Stored in `camera.json` in the app data folder (zod-validated, atomic write). `null` leaves the value to the camera. Saving is refused while a photo session is active.
- Bridge command `camera.configure {iso, av, tv, maxEdge, quality}` runs before every `cameraOpen` and `cameraProbe`. `camera.open` then applies each configured value and **reads it back**; refusals and mismatches are traced (`camera.setting.iso|av|tv`) and returned in `applied`, never fatal. The probe shows the same result as a `settings` step.
- Aperture and shutter are accepted by the camera only with the dial on Av, Tv or M (probe in P mode read both as 0). ISO works in every mode. The dial cannot be changed by software.
- Output size: after download, `Shrink` resizes the JPEG to the configured longest edge (default 2000 px, quality 85, bicubic, EXIF orientation applied because re-encoding drops EXIF) before it is written to the capture path. Presets: 1280/80, 1600/82, 2000/85, 3000/90, original. The 24 MP original of about 6 to 8 MB becomes a few hundred KB.
- While the camera focuses and exposes, live view is stopped; the UI now shows "Mengambil foto… Kamera sedang fokus" over the last frame instead of looking frozen.

Not verified without hardware: Aperture/shutter code labels outside whole stops, `Shrink` (System.Drawing is Windows-only), and the set/readback behaviour on the real camera. Check with Tes kamera Canon after saving.

### Capture failures seen in the field (1.2.1)

Diagnostics from 17 and 24 Oct 2026 (about 28 captures) show two failure kinds that predate 1.2.0: (a) the shutter answers in under 100 ms (no autofocus) and the photo never arrives, ending in the 45 s timeout; (b) the shutter is refused with `DeviceBusy` after the 4 to 6 s autofocus search. 1.2.1 changes:

- `DeviceBusy` is reported as `CAMERA_FOCUS_FAILED` ("kamera belum berhasil fokus") and the camera session stays open, so the guest can press Ambil foto again.
- After a fast shutter answer the transfer wait is 12 s instead of 45 s. On timeout the remaining-shot count (`GetAvailableShots`) before and after is compared (trace `camera.capture.lost`, `count` = shots used): if it did not drop, the camera did not expose and the shutter is tried once more (`camera.capture.retry`); if it dropped, or the count is unavailable, nothing is retried (no double shot) and the error is `CAMERA_PHOTO_NOT_RECEIVED`.
- Aperture/shutter are only written when the dial mode allows them (Av/Manual, Tv/Manual); otherwise the probe reports `dilewati (mode X)` instead of a DeviceBusy refusal.
- The probe also reads the allowed values for PTP codes `D101`/`D102` (guessed Av/Tv) to calibrate the label tables.

The root cause of (a) is not established; the new trace shows whether the photo was exposed but lost, or never taken.
