using System.Diagnostics;
using System.Runtime.Versioning;
using FC.SDK;
using FC.SDK.Canon;

// Camera self-test for the staff menu: finds a Canon over USB (WPD/PTP, no Canon DLLs), reads live view and takes one photo.
// Every step is timed and reduced to a short code so the result can be shown on screen and sent to the server. The test photo is deleted.
[SupportedOSPlatform("windows")]
static class CanonProbe {
    sealed record Step(string name, bool ok, long ms, string? code = null, string? detail = null, long? size_bytes = null);
    static int running;

    static string Short(string? text, int max) {
        var clean = new string((text ?? "").Where(c => !char.IsControl(c)).ToArray());
        return clean.Length <= max ? clean : clean[..max];
    }
    static string Code(Exception e) => e is TimeoutException ? "TIMEOUT" : e.GetType().Name.ToUpperInvariant() switch { var n when n.Length <= 40 => n, _ => "ERROR" };
    static bool IsJpeg(byte[]? b) => b is { Length: > 8 } && b[0] == 0xff && b[1] == 0xd8 && b[2] == 0xff;

    // Read-only inspection of exposure settings. FC.SDK is called by name so the probe still builds if a signature differs;
    // the recorded signatures and allowed values tell us the exact API for a later settings feature. Nothing here changes the camera.
    static string Fmt(object? v) {
        if (v is null) return "null";
        if (v is string text) return text;
        if (v is System.Collections.IEnumerable list) return "[" + string.Join(",", list.Cast<object?>().Take(40).Select(x => x?.ToString())) + "]";
        return v.ToString() ?? "";
    }
    static string TypeName(Type t) => t.IsGenericType ? t.Name.Split('`')[0] + "<" + string.Join(",", t.GetGenericArguments().Select(TypeName)) + ">" : t.Name;
    static string Signature(System.Reflection.MethodInfo m) => $"{m.Name.Replace("Async", "")}:{TypeName(m.ReturnType).Replace("Task", "T").Replace("ValueT", "VT")}({string.Join(", ", m.GetParameters().Select(p => TypeName(p.ParameterType)))})";
    static async Task<string> ReadSetting(CanonCamera canon, string name) {
        var method = typeof(CanonCamera).GetMethods().Where(m => m.Name == name && m.GetParameters().All(p => p.HasDefaultValue)).FirstOrDefault();
        if (method is null) throw new MissingMethodException(name);
        var result = method.Invoke(canon, method.GetParameters().Select(p => p.DefaultValue is DBNull ? null : p.DefaultValue).ToArray());
        if (result is not null && result.GetType().Name.StartsWith("ValueTask")) result = result.GetType().GetMethod("AsTask")!.Invoke(result, null);
        if (result is Task task) {
            await task.WaitAsync(TimeSpan.FromSeconds(10));
            return Fmt(task.GetType().GetProperty("Result")?.GetValue(task));
        }
        return Fmt(result);
    }
    static readonly string[] SettingGetters = { "GetISOAsync", "GetApertureAsync", "GetShutterSpeedAsync", "GetAEModeAsync", "GetAvailableShotsAsync" };
    static readonly (string, string[])[] SettingApiGroups = {
        ("iso", new[] { "GetISOAsync", "SetISOAsync" }), ("av-tv", new[] { "GetApertureAsync", "SetApertureAsync", "GetShutterSpeedAsync", "SetShutterSpeedAsync" }),
        ("raw", new[] { "GetRawAllowedValuesAsync", "GetRawPropertyAsync" }), ("set", new[] { "SetPropertyAsync", "SetPropertyUInt32Async", "SetWhiteBalanceAsync" }) };

    static readonly (string, ushort[])[] AllowedProps = { ("iso", new ushort[] { 0xD103 }), ("img", new ushort[] { 0xD120, 0xD121 }) };

    public static async Task<object> Run(string root, string probeId) {
        if (Interlocked.Exchange(ref running, 1) == 1) throw new Exception("CAMERA_BUSY");
        var total = Stopwatch.StartNew();
        var steps = new List<Step>();
        var cameras = new List<object>();
        string? model = null, serialTail = null;
        string? photo = null;
        async Task<T?> Do<T>(string name, Func<Task<T>> body, Func<T, (bool ok, string? code, string? detail, long? bytes)>? judge = null) {
            var clock = Stopwatch.StartNew();
            try {
                var value = await body();
                var (ok, code, detail, bytes) = judge is null ? (true, (string?)null, (string?)null, (long?)null) : judge(value);
                steps.Add(new Step(name, ok, clock.ElapsedMilliseconds, code, detail is null ? null : Short(detail, 200), bytes));
                return value;
            } catch (Exception e) {
                steps.Add(new Step(name, false, clock.ElapsedMilliseconds, Code(e), Short($"{e.GetType().Name} 0x{e.HResult:X8} {e.Message}", 200)));
                return default;
            }
        }
        try {
            var found = await Do("enumerate", () => Task.FromResult(CanonCamera.EnumerateWpdCameras().ToList()),
                list => (list.Count > 0, list.Count > 0 ? null : "NO_CAMERA", $"{list.Count} camera(s)", null));
            if (found is null || found.Count == 0) return Result(false);
            foreach (var camera in found.Take(5)) cameras.Add(new { name = Short(camera.ToString(), 100) });

            CanonCamera? canon = null;
            try {
                canon = await Do("connect", () => CanonCamera.ConnectWpdAutoAsync(found[0].Item1).WaitAsync(TimeSpan.FromSeconds(20)));
                if (canon is null) return Result(false);
                await Do("session", async () => { await canon.OpenSessionAsync().WaitAsync(TimeSpan.FromSeconds(15)); return true; });
                model = Short(canon.Model?.ToString(), 100);
                var serial = canon.SerialNumber?.ToString() ?? "";
                serialTail = Short(serial.Length > 4 ? serial[^4..] : serial, 8);
                if (!steps[^1].ok) return Result(false);
                canon.StartEventPolling();

                await Do("info-values", async () => {
                    var parts = new List<string>();
                    foreach (var getter in SettingGetters) {
                        try { parts.Add(getter.Replace("Get", "").Replace("Async", "") + "=" + await ReadSetting(canon, getter)); }
                        catch (Exception ex) { parts.Add(getter.Replace("Get", "").Replace("Async", "") + "!" + ex.GetType().Name); }
                    }
                    return string.Join(" ", parts);
                }, v => (true, null, v, null));
                foreach (var (label, names) in SettingApiGroups)
                    await Do("info-api-" + label, () => Task.FromResult(string.Join(" | ", typeof(CanonCamera).GetMethods().Where(m => names.Contains(m.Name)).Select(Signature))),
                        v => (v.Length > 0, v.Length > 0 ? null : "NO_METHOD", v.Length > 0 ? v : label, null));
                // PTP property codes are guesses from the Canon EOS PTP map; each is read independently so a wrong code only shows as an error.
                foreach (var (label, codes) in AllowedProps)
                    await Do("info-allowed-" + label, async () => {
                        var parts = new List<string>();
                        foreach (var code in codes) {
                            try {
                                var (err, now) = await canon.GetRawPropertyAsync(code, CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(10));
                                var allowed = await canon.GetRawAllowedValuesAsync(code, CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(10));
                                parts.Add($"{code:X4} {err} now={now:X} [{string.Join(",", (allowed ?? Array.Empty<uint>()).Take(24).Select(v => v.ToString("X")))}]");
                            } catch (Exception ex) { parts.Add($"{code:X4}!{ex.GetType().Name}"); }
                        }
                        return string.Join(" ", parts);
                    }, v => (true, null, v, null));

                await Do("liveview", async () => {
                    await canon.StartLiveViewAsync().WaitAsync(TimeSpan.FromSeconds(15));
                    byte[]? last = null; var good = 0; string error = "";
                    for (var i = 0; i < 3; i++) {
                        var (err, jpeg) = await canon.GetLiveViewFrameAsync().WaitAsync(TimeSpan.FromSeconds(10));
                        error = err.ToString() ?? "";
                        if (IsJpeg(jpeg)) { good++; last = jpeg; }
                        await Task.Delay(120);
                    }
                    await canon.StopLiveViewAsync().WaitAsync(TimeSpan.FromSeconds(10));
                    return (good, bytes: last?.Length ?? 0, error);
                }, r => (r.good > 0, r.good > 0 ? null : "LIVEVIEW_EMPTY", $"{r.good}/3 frames, last error={r.error}", r.bytes));

                var done = new TaskCompletionSource<long>();
                await Do("save-to-host", async () => { await canon.SetSaveToAsync(EdsSaveTo.Host).WaitAsync(TimeSpan.FromSeconds(10)); return true; });
                canon.ObjectAdded += async (_, e) => {
                    try {
                        var path = Path.Combine(root, $"probe-{probeId}.jpg");
                        await using (var file = new FileStream(path, FileMode.Create, FileAccess.Write)) await canon.DownloadAsync(e.ObjectHandle, file);
                        await canon.TransferCompleteAsync(e.ObjectHandle);
                        photo = path;
                        var head = new byte[16]; await using (var read = File.OpenRead(path)) _ = await read.ReadAsync(head);
                        done.TrySetResult(IsJpeg(head) ? new FileInfo(path).Length : 0);
                    } catch (Exception ex) { done.TrySetException(ex); }
                };
                await Do("capture", async () => {
                    await canon.TakePictureAsync().WaitAsync(TimeSpan.FromSeconds(15));
                    return await done.Task.WaitAsync(TimeSpan.FromSeconds(30));
                }, size => (size > 0, size > 0 ? null : "CAPTURE_NOT_JPEG", null, size));
            } finally {
                if (canon is not null) { try { await canon.DisposeAsync(); } catch { } }
            }
            return Result(steps.Where(s => !s.name.StartsWith("info-")).All(s => s.ok));
        } finally {
            if (photo is not null) { try { File.Delete(photo); } catch { } }
            Interlocked.Exchange(ref running, 0);
        }
        object Result(bool ok) => new { ok, total_ms = total.ElapsedMilliseconds, cameras, model, serial_tail = serialTail, steps };
    }
}
