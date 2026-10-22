using System.Runtime.Versioning;
using FC.SDK;
using FC.SDK.Canon;

// A single USB session owns both preview and shutter. Commands are serialized by Program's JSON-lines loop.
[SupportedOSPlatform("windows")]
sealed class CanonSession {
    CanonCamera? camera;
    bool live;
    TaskCompletionSource<byte[]>? pending;
    static bool Jpeg(byte[]? b) => b is { Length: > 8 } && b[0] == 255 && b[1] == 216 && b[2] == 255;
    public static string Status() {
        try { return CanonCamera.EnumerateWpdCameras().Any() ? "CANON_SDK" : "CAMERA_NOT_CONNECTED"; }
        catch { return "CAMERA_NOT_CONNECTED"; }
    }
    public async Task<object> Open() {
        if (camera is not null) return new { source = "canon-sdk" };
        var found = CanonCamera.EnumerateWpdCameras().ToList();
        if (found.Count == 0) throw new Exception("CAMERA_NOT_CONNECTED");
        try {
            camera = await CanonCamera.ConnectWpdAutoAsync(found[0].Item1).WaitAsync(TimeSpan.FromSeconds(20));
            await camera.OpenSessionAsync().WaitAsync(TimeSpan.FromSeconds(15));
            camera.StartEventPolling();
            var active = camera;
            active.ObjectAdded += async (_, e) => {
                var completion = Interlocked.Exchange(ref pending, null);
                if (completion is null) return;
                try {
                    using var data = new MemoryStream();
                    await active.DownloadAsync(e.ObjectHandle, data).WaitAsync(TimeSpan.FromSeconds(30));
                    await active.TransferCompleteAsync(e.ObjectHandle).WaitAsync(TimeSpan.FromSeconds(10));
                    var bytes = data.ToArray();
                    if (bytes.Length > 16 * 1024 * 1024 || !Jpeg(bytes)) throw new Exception("CAMERA_INVALID_JPEG");
                    completion.TrySetResult(bytes);
                } catch { completion.TrySetException(new Exception("CAMERA_TRANSFER_FAILED")); }
            };
            await camera.StartLiveViewAsync().WaitAsync(TimeSpan.FromSeconds(15)); live = true;
            return new { source = "canon-sdk" };
        } catch { await Close(); throw; }
    }
    public async Task<object> Frame() {
        if (camera is null) throw new Exception("CAMERA_NOT_CONNECTED");
        try {
            if (!live) { await camera.StartLiveViewAsync().WaitAsync(TimeSpan.FromSeconds(15)); live = true; }
            var (_, jpeg) = await camera.GetLiveViewFrameAsync().WaitAsync(TimeSpan.FromSeconds(10));
            // A temporarily empty frame is normal while the camera changes mode.
            return new { url = Jpeg(jpeg) && jpeg!.Length <= 2 * 1024 * 1024 ? "data:image/jpeg;base64," + Convert.ToBase64String(jpeg) : null };
        } catch { await Close(); throw new Exception("CAMERA_DISCONNECTED"); }
    }
    public async Task<object> Capture(string root, string id) {
        if (camera is null) throw new Exception("CAMERA_NOT_CONNECTED");
        var target = Path.Combine(root, id + ".jpg");
        try {
            if (live) { await camera.StopLiveViewAsync().WaitAsync(TimeSpan.FromSeconds(10)); live = false; }
            await camera.SetSaveToAsync(EdsSaveTo.Host).WaitAsync(TimeSpan.FromSeconds(10));
            var completion = new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously);
            pending = completion;
            var shutter = await camera.TakePictureAsync().WaitAsync(TimeSpan.FromSeconds(15));
            if (Convert.ToUInt32(shutter) != 0) throw new Exception("CAMERA_SHUTTER_REFUSED");
            var bytes = await completion.Task.WaitAsync(TimeSpan.FromSeconds(45));
            using (var check = new MemoryStream(bytes))
            using (var image = System.Drawing.Image.FromStream(check, false, true)) {
                if (image.Width < 1 || image.Height < 1 || (long)image.Width * image.Height > 25000000) throw new Exception("CAMERA_INVALID_JPEG");
            }
            await using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write)) await output.WriteAsync(bytes);
            // Preview restarts on the next frame request; failure cannot discard a completed shutter transfer.
            return new { captureId = id, path = target, simulated = false, source = "canon-sdk" };
        } catch {
            await Close();
            // A timeout may follow a real shutter: never retry it automatically.
            throw new Exception("CAMERA_CAPTURE_FAILED");
        } finally { pending = null; }
    }
    public async Task<object> Close() {
        pending?.TrySetException(new Exception("CAMERA_DISCONNECTED")); pending = null;
        var old = camera; camera = null; live = false;
        if (old is not null) { try { await old.DisposeAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(10)); } catch { } }
        return new { closed = true };
    }
}
