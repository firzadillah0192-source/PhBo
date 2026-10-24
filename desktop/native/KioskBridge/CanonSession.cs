using System.Runtime.Versioning;
using System.Diagnostics;
using FC.SDK;
using FC.SDK.Canon;

// A single USB session owns both preview and shutter. Commands are serialized by Program's JSON-lines loop.
[SupportedOSPlatform("windows")]
sealed class CanonSession {
    CanonCamera? camera;
    bool live;
    public sealed record Wanted(uint? Iso, uint? Av, uint? Tv, int MaxEdge, int Quality);
    // Set by camera.configure before each open; the probe reads the same values. MaxEdge 0 keeps the camera original.
    public static Wanted Settings { get; private set; } = new(null, null, null, 0, 90);
    public static object Configure(uint? iso, uint? av, uint? tv, int maxEdge, int quality) {
        if (iso > 0xFF || av > 0xFF || tv > 0xFF) throw new Exception("INVALID_ARGUMENT");
        if ((maxEdge != 0 && (maxEdge < 640 || maxEdge > 6000)) || quality < 50 || quality > 95) throw new Exception("INVALID_ARGUMENT");
        Settings = new Wanted(iso, av, tv, maxEdge, quality);
        return new { configured = true };
    }
    // Sets each configured exposure value and reads it back. A refusal (for example Av/Tv while the dial is not on Av/Tv/M) is reported, never fatal.
    public static async Task<string> ApplyExposure(CanonCamera cam, Wanted want) {
        var parts = new List<string>();
        async Task Step<T>(string name, uint? code, Func<uint, Task<EdsError>> set, Func<Task<(EdsError, T)>> get) {
            if (code is null) return;
            try {
                var err = await set(code.Value).WaitAsync(TimeSpan.FromSeconds(10));
                if (Convert.ToUInt32(err) != 0) { parts.Add($"{name}={code:X} ditolak {err}"); CanonTrace.Emit("camera.setting." + name, "error", code: err.ToString()); return; }
                var (_, now) = await get().WaitAsync(TimeSpan.FromSeconds(10));
                var match = Convert.ToUInt32(now) == code.Value;
                parts.Add($"{name}={code:X} {(match ? "ok" : "beda:" + now)}");
                CanonTrace.Emit("camera.setting." + name, match ? "ok" : "error", code: match ? null : "READBACK_MISMATCH");
            } catch (Exception e) { parts.Add($"{name}!{e.GetType().Name}"); CanonTrace.Error("camera.setting." + name, e); }
        }
        await Step("iso", want.Iso, c => cam.SetISOAsync((EdsISOSpeed)c), () => cam.GetISOAsync());
        await Step("av", want.Av, c => cam.SetApertureAsync((EdsAv)c), () => cam.GetApertureAsync());
        await Step("tv", want.Tv, c => cam.SetShutterSpeedAsync((EdsTv)c), () => cam.GetShutterSpeedAsync());
        try { var (_, mode) = await cam.GetAEModeAsync().WaitAsync(TimeSpan.FromSeconds(10)); parts.Add("mode=" + mode); } catch { }
        return string.Join(" ", parts);
    }
    // Longest edge and JPEG quality for the file handed to the rest of the app. Orientation is baked in because re-encoding drops EXIF.
    static byte[] Shrink(byte[] source, int maxEdge, int quality) {
        if (maxEdge == 0) return source;
        using var input = new MemoryStream(source);
        using var original = System.Drawing.Image.FromStream(input, false, true);
        var orientation = original.PropertyIdList.Contains(0x0112) ? original.GetPropertyItem(0x0112)?.Value?[0] ?? 1 : 1;
        using var upright = new System.Drawing.Bitmap(original);
        upright.RotateFlip(orientation switch { 3 => System.Drawing.RotateFlipType.Rotate180FlipNone, 6 => System.Drawing.RotateFlipType.Rotate90FlipNone, 8 => System.Drawing.RotateFlipType.Rotate270FlipNone, _ => System.Drawing.RotateFlipType.RotateNoneFlipNone });
        var longest = Math.Max(upright.Width, upright.Height);
        if (longest <= maxEdge && orientation == 1) return source;
        var scale = Math.Min(1.0, (double)maxEdge / longest);
        var width = Math.Max(1, (int)Math.Round(upright.Width * scale)); var height = Math.Max(1, (int)Math.Round(upright.Height * scale));
        using var small = new System.Drawing.Bitmap(width, height, System.Drawing.Imaging.PixelFormat.Format24bppRgb);
        using (var g = System.Drawing.Graphics.FromImage(small)) {
            g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
            g.DrawImage(upright, 0, 0, width, height);
        }
        var jpeg = System.Drawing.Imaging.ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == System.Drawing.Imaging.ImageFormat.Jpeg.Guid);
        using var parameters = new System.Drawing.Imaging.EncoderParameters(1);
        parameters.Param[0] = new System.Drawing.Imaging.EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)quality);
        using var output = new MemoryStream();
        small.Save(output, jpeg, parameters);
        return output.ToArray();
    }
    TaskCompletionSource<byte[]>? pending;
    static bool Jpeg(byte[]? b) => b is { Length: > 8 } && b[0] == 255 && b[1] == 216 && b[2] == 255;
    public static string Status() {
        try { return CanonCamera.EnumerateWpdCameras().Any() ? "CANON_SDK" : "CAMERA_NOT_CONNECTED"; }
        catch (Exception e) { CanonTrace.Error("camera.enumerate", e); return "CAMERA_NOT_CONNECTED"; }
    }
    public async Task<object> Open() {
        if (camera is not null) return new { source = "canon-sdk" };
        var found = CanonTrace.Sync("camera.enumerate", () => CanonCamera.EnumerateWpdCameras().ToList());
        CanonTrace.Emit("camera.enumerate", "ok", count: found.Count);
        if (found.Count == 0) { CanonTrace.Emit("camera.enumerate", "error", code: "CAMERA_NOT_CONNECTED"); throw new Exception("CAMERA_NOT_CONNECTED"); }
        try {
            camera = await CanonTrace.Run("camera.connect", () => CanonCamera.ConnectWpdAutoAsync(found[0].Item1).WaitAsync(TimeSpan.FromSeconds(20)));
            await CanonTrace.Run("camera.session.open", () => camera.OpenSessionAsync().WaitAsync(TimeSpan.FromSeconds(15)));
            camera.StartEventPolling(); CanonTrace.Emit("camera.event_polling", "ok");
            var applied = await ApplyExposure(camera, Settings);
            var active = camera;
            active.ObjectAdded += async (_, e) => {
                var completion = Interlocked.Exchange(ref pending, null);
                if (completion is null) return;
                try {
                    using var data = new MemoryStream();
                    await CanonTrace.Run("camera.transfer.download", () => active.DownloadAsync(e.ObjectHandle, data).WaitAsync(TimeSpan.FromSeconds(30)));
                    await CanonTrace.Run("camera.transfer.complete", () => active.TransferCompleteAsync(e.ObjectHandle).WaitAsync(TimeSpan.FromSeconds(10)));
                    var bytes = data.ToArray();
                    if (bytes.Length > 16 * 1024 * 1024 || !Jpeg(bytes)) throw new Exception("CAMERA_INVALID_JPEG");
                    completion.TrySetResult(bytes);
                } catch (Exception error) { CanonTrace.Error("camera.transfer", error); completion.TrySetException(new Exception("CAMERA_TRANSFER_FAILED")); }
            };
            await CanonTrace.Run("camera.liveview.start", () => camera.StartLiveViewAsync().WaitAsync(TimeSpan.FromSeconds(15))); live = true;
            return new { source = "canon-sdk", applied };
        } catch { await Close(); throw; }
    }
    public async Task<object> Frame() {
        if (camera is null) throw new Exception("CAMERA_NOT_CONNECTED");
        try {
            if (!live) { await CanonTrace.Run("camera.liveview.start", () => camera.StartLiveViewAsync().WaitAsync(TimeSpan.FromSeconds(15))); live = true; }
            var clock = Stopwatch.StartNew();
            var (sdk, jpeg) = await camera.GetLiveViewFrameAsync().WaitAsync(TimeSpan.FromSeconds(10));
            CanonTrace.Emit("camera.preview.frame", Jpeg(jpeg) ? "ok" : "empty", clock.ElapsedMilliseconds, sdk: sdk.ToString(), bytes: jpeg?.Length ?? 0);
            // A temporarily empty frame is normal while the camera changes mode.
            return new { url = Jpeg(jpeg) && jpeg!.Length <= 2 * 1024 * 1024 ? "data:image/jpeg;base64," + Convert.ToBase64String(jpeg) : null };
        } catch (Exception e) { CanonTrace.Error("camera.preview.frame", e); await Close(); throw new Exception("CAMERA_DISCONNECTED"); }
    }
    public async Task<object> Capture(string root, string id) {
        if (camera is null) throw new Exception("CAMERA_NOT_CONNECTED");
        var target = Path.Combine(root, id + ".jpg");
        try {
            if (live) { await CanonTrace.Run("camera.liveview.stop", () => camera.StopLiveViewAsync().WaitAsync(TimeSpan.FromSeconds(10))); live = false; }
            await CanonTrace.Run("camera.save_to_host", () => camera.SetSaveToAsync(EdsSaveTo.Host).WaitAsync(TimeSpan.FromSeconds(10)));
            var completion = new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously);
            pending = completion;
            var shutter = await CanonTrace.Run("camera.shutter", () => camera.TakePictureAsync().WaitAsync(TimeSpan.FromSeconds(15)));
            if (Convert.ToUInt32(shutter) != 0) throw new Exception("CAMERA_SHUTTER_REFUSED");
            var bytes = await CanonTrace.Run("camera.transfer.wait", () => completion.Task.WaitAsync(TimeSpan.FromSeconds(45)));
            using (var check = new MemoryStream(bytes))
            using (var image = System.Drawing.Image.FromStream(check, false, true)) {
                if (image.Width < 1 || image.Height < 1 || (long)image.Width * image.Height > 25000000) throw new Exception("CAMERA_INVALID_JPEG");
            }
            var original = bytes.Length;
            try { bytes = Shrink(bytes, Settings.MaxEdge, Settings.Quality); } catch (Exception e) { CanonTrace.Error("camera.capture.shrink", e); }
            await using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write)) await output.WriteAsync(bytes);
            // Preview restarts on the next frame request; failure cannot discard a completed shutter transfer.
            CanonTrace.Emit("camera.capture.saved", "ok", bytes: bytes.Length, count: original);
            return new { captureId = id, path = target, simulated = false, source = "canon-sdk" };
        } catch (Exception e) {
            CanonTrace.Error("camera.capture", e);
            await Close();
            // A timeout may follow a real shutter: never retry it automatically.
            throw new Exception("CAMERA_CAPTURE_FAILED");
        } finally { pending = null; }
    }
    public async Task<object> Close() {
        pending?.TrySetException(new Exception("CAMERA_DISCONNECTED")); pending = null;
        var old = camera; camera = null; live = false;
        if (old is not null) { try { await CanonTrace.Run("camera.session.close", () => old.DisposeAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(10))); } catch (Exception e) { CanonTrace.Error("camera.session.close", e); } }
        return new { closed = true };
    }
}
