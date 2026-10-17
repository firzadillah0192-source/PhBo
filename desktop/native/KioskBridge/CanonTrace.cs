using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;

// The stderr channel carries scalar diagnostics only. Never serialize camera objects, paths, frames or exception messages.
static class CanonTrace {
    public static void Emit(string action, string status, long ms = 0, string? code = null, string? sdk = null, long? bytes = null, int? count = null, string? exception = null, string? hresult = null) {
        try { Console.Error.WriteLine(JsonSerializer.Serialize(new { kind = "camera-diagnostic", action, status, ms, code, sdk, bytes, count, exception, hresult })); } catch { }
    }
    public static void Error(string action, Exception e, long ms = 0) {
        var code = e is TimeoutException ? "TIMEOUT" : Regex.IsMatch(e.Message, "^[A-Z][A-Z0-9_]{0,79}$") ? e.Message : "NATIVE_EXCEPTION";
        Emit(action, "error", ms, code, exception: e.GetType().Name, hresult: $"0x{e.HResult:X8}");
    }
    public static T Sync<T>(string action, Func<T> operation) {
        var clock = Stopwatch.StartNew(); Emit(action, "begin");
        try { var result = operation(); Emit(action, "ok", clock.ElapsedMilliseconds); return result; }
        catch (Exception e) { Error(action, e, clock.ElapsedMilliseconds); throw; }
    }
    public static async Task<T> Run<T>(string action, Func<Task<T>> operation) {
        var clock = Stopwatch.StartNew(); Emit(action, "begin");
        try {
            var value = await operation();
            var sdk = value is Enum ? value.ToString() : null;
            Emit(action, value is Enum && Convert.ToInt64(value) != 0 ? "error" : "ok", clock.ElapsedMilliseconds, sdk: sdk);
            return value;
        } catch (Exception e) { Error(action, e, clock.ElapsedMilliseconds); throw; }
    }
    public static async Task Run(string action, Func<Task> operation) {
        var clock = Stopwatch.StartNew(); Emit(action, "begin");
        try { await operation(); Emit(action, "ok", clock.ElapsedMilliseconds); }
        catch (Exception e) { Error(action, e, clock.ElapsedMilliseconds); throw; }
    }
}
