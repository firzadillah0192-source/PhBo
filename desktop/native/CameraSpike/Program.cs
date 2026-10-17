using FC.SDK;
using FC.SDK.Canon;

// Hardware spike: EOS 2000D over USB via FC.SDK WPD (no Canon DLLs). Run on the Windows kiosk PC.
// Usage: CameraSpike [outDir]   - lists cameras, saves 5 live view frames, takes one photo.
var outDir = Path.GetFullPath(args.Length > 0 ? args[0] : "spike-out");
Directory.CreateDirectory(outDir);
if (!OperatingSystem.IsWindows()) { Console.Error.WriteLine("Windows only (WPD)."); return 2; }

var cameras = CanonCamera.EnumerateWpdCameras().ToList();
Console.WriteLine($"WPD cameras found: {cameras.Count}");
foreach (var c in cameras) Console.WriteLine($"  {c}");
if (cameras.Count == 0) { Console.Error.WriteLine("No camera. Close EOS Utility/Webcam apps, set camera ON, check USB cable."); return 3; }

await using var camera = await CanonCamera.ConnectWpdAutoAsync(cameras[0].Item1);
await camera.OpenSessionAsync();
Console.WriteLine($"Connected: {camera.Model} serial {camera.SerialNumber}");
camera.StartEventPolling();

await camera.StartLiveViewAsync();
for (var i = 0; i < 5; i++) {
    var (error, jpeg) = await camera.GetLiveViewFrameAsync();
    Console.WriteLine($"live view frame {i}: error={error} bytes={jpeg?.Length ?? 0}");
    if (jpeg is not null) await File.WriteAllBytesAsync(Path.Combine(outDir, $"liveview-{i}.jpg"), jpeg);
    await Task.Delay(120);
}
await camera.StopLiveViewAsync();

var done = new TaskCompletionSource<string>();
await camera.SetSaveToAsync(EdsSaveTo.Host);
camera.ObjectAdded += async (_, e) => {
    try {
        var (_, name) = await camera.GetObjectFileNameAsync(e.ObjectHandle);
        var path = Path.Combine(outDir, Path.GetFileName(name ?? "capture.jpg"));
        await using (var fs = File.Create(path)) await camera.DownloadAsync(e.ObjectHandle, fs);
        await camera.TransferCompleteAsync(e.ObjectHandle);
        done.TrySetResult(path);
    } catch (Exception ex) { done.TrySetException(ex); }
};
await camera.TakePictureAsync();
var finished = await Task.WhenAny(done.Task, Task.Delay(TimeSpan.FromSeconds(30)));
if (finished != done.Task) { Console.Error.WriteLine("Timeout waiting for photo transfer."); return 4; }
var file = await done.Task;
Console.WriteLine($"Saved {file} ({new FileInfo(file).Length} bytes)");
return 0;
