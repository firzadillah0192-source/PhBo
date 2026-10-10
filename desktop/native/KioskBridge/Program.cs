using System.Text.Json;
using System.Text.RegularExpressions;

// JSON-lines adapter v1. Only the trusted Electron main process starts this process.
var rootArg = Array.IndexOf(args, "--root");
if (rootArg < 0 || rootArg + 1 >= args.Length) return 2;
var root = Path.GetFullPath(args[rootArg + 1]);
Directory.CreateDirectory(root);
var simulated = args.Contains("--simulated");
string? fixture = null;
var prints = new HashSet<string>();
string Required(JsonElement p, string key) => p.GetProperty(key).GetString() ?? throw new Exception("INVALID_ARGUMENT");
string SafeId(string id) => Regex.IsMatch(id, "^[a-f0-9]{32}$") ? id : throw new Exception("INVALID_ID");
string Inside(string file) {
    var full = Path.GetFullPath(file);
    if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new Exception("PATH_FORBIDDEN");
    if ((File.GetAttributes(full) & FileAttributes.ReparsePoint) != 0) throw new Exception("PATH_FORBIDDEN");
    return full;
}
bool IsImage(byte[] b) => (b.Length > 8 && b[0] == 0xff && b[1] == 0xd8 && b[2] == 0xff) ||
    (b.Length > 8 && b.Take(8).SequenceEqual(new byte[] {137,80,78,71,13,10,26,10}));
while (await Console.In.ReadLineAsync() is { } line) {
    string? id = null;
    try {
        if (line.Length > 65536) throw new Exception("REQUEST_TOO_LARGE");
        using var doc = JsonDocument.Parse(line);
        var req = doc.RootElement;
        id = Required(req, "id");
        if (req.GetProperty("version").GetInt32() != 1) throw new Exception("VERSION_UNSUPPORTED");
        var method = Required(req, "method");
        var p = req.GetProperty("params");
        object result;
        switch (method) {
            case "devices.status":
                result = simulated ? new { simulated, camera = fixture == null ? "FIXTURE_REQUIRED" : "READY", printer = "SIMULATED" } :
                    OperatingSystem.IsWindows() ? new { simulated, camera = "BROWSER_WEBCAM", printing = WindowsPrinter.Status() } :
                    (object)new { simulated, camera = "CAMERA_NOT_CONNECTED", printer = "PRINTER_NOT_CONNECTED" };
                break;
            case "printer.plan":
                result = new { rectangles = PrintLayout.Plan(Required(p, "profile"), p.GetProperty("width").GetInt32(), p.GetProperty("height").GetInt32()), paper = new[] { 400, 600 } };
                break;
            case "camera.setFixture":
                if (!simulated) throw new Exception("CAMERA_NOT_CONNECTED");
                var source = Path.GetFullPath(Required(p, "path"));
                var info = new FileInfo(source);
                if (!info.Exists || info.Length > 12 * 1024 * 1024 || !IsImage(await File.ReadAllBytesAsync(source))) throw new Exception("INVALID_IMAGE");
                fixture = source;
                result = new { ready = true, simulated = true }; break;
            case "camera.capture":
                if (!simulated) throw new Exception("CAMERA_NOT_CONNECTED");
                if (fixture == null) throw new Exception("FIXTURE_REQUIRED");
                var bytes = await File.ReadAllBytesAsync(fixture);
                if (bytes.Length > 12 * 1024 * 1024 || !IsImage(bytes)) throw new Exception("INVALID_IMAGE");
                var captureId = SafeId(Required(p, "captureId"));
                var target = Path.Combine(root, captureId + (bytes[0] == 137 ? ".png" : ".jpg"));
                // Never overwrite a previous capture, including after a retry.
                await using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write)) await output.WriteAsync(bytes);
                result = new { captureId, path = target, simulated = true }; break;
            case "printer.submit":
                if (!simulated && !OperatingSystem.IsWindows()) throw new Exception("PRINTER_NOT_CONNECTED");
                var jobId = SafeId(Required(p, "jobId"));
                var asset = Inside(Required(p, "path"));
                if (!IsImage(await File.ReadAllBytesAsync(asset))) throw new Exception("INVALID_IMAGE");
                if (!simulated) { result = WindowsPrinter.Submit(asset, jobId, root, Required(p, "profile")); break; }
                if (!prints.Add(jobId)) throw new Exception("PRINT_ALREADY_SUBMITTED");
                result = new { jobId, status = "SIMULATED", simulated = true }; break;
            default: throw new Exception("METHOD_UNSUPPORTED");
        }
        Console.WriteLine(JsonSerializer.Serialize(new { version = 1, id, ok = true, result }));
    } catch (Exception e) {
        var code = Regex.IsMatch(e.Message, "^[A-Z_]+$") ? e.Message : "ADAPTER_ERROR";
        Console.WriteLine(JsonSerializer.Serialize(new { version = 1, id, ok = false, error = new { code } }));
    }
}
return 0;
