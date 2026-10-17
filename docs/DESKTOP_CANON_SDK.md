# Canon USB capture: desktop 1.0.2

Windows desktop photo sessions now use the bundled FC.SDK 3.2.1021 over WPD/PTP for both live view and shutter/JPEG transfer. This is the same USB integration used by the staff camera probe. No Canon EDSDK DLL, .NET SDK installation or EOS Webcam Utility is required for this path. The runtime is bundled in the Windows installer. Close other camera applications, turn the camera on, connect a USB data cable and select JPEG capture on the camera.

Internal adapter commands: `camera.open`, `camera.frame` (bounded preview JPEG data URL), `camera.capture` (safe capture ID -> predetermined JPEG asset path) and `camera.close`. Electron exposes `cameraOpen`, `cameraFrame`, `cameraClose` and the existing `capture`. Windows rejects `captureWebcam`; a failed USB connection never switches to a webcam. The staff probe closes any earlier USB session before testing.

The session opens on the capture screen and closes when leaving it. Preview pauses for shutter and restarts on the next frame. A photo is recorded only after a real JPEG has transferred, passed the existing image checks and been saved. Retake opens the capture screen again. Preview disconnects disable capture and offer **Sambungkan ulang kamera**. A shutter/transfer failure is surfaced; it is not automatically repeated, since a timeout can follow a real shutter.

The non-Windows development path keeps browser webcam capture. Simulation remains explicit and cannot be enabled by the customer renderer. Preview frames are kept in memory, not written to logs or support reports.

Validation: .NET build, desktop unit tests, real Electron simulation/webcam regressions and a browser test of SDK-only preview/capture/retake/disconnect with mocked IPC. These do not establish physical Windows camera acceptance. After installing 1.0.2 on the kiosk, verify USB preview, shutter/JPEG, multiple Classic poses, retake, disconnect/reconnect and then send a fresh support report.

Release scope: 1.0.2 is built from `origin/main` f999214 plus this camera fix. The shared workspace's unreleased 1.1.0 event/updater changes are excluded from this installer; the event source in the shared workspace also uses the new camera hook and stops on capture failure.
