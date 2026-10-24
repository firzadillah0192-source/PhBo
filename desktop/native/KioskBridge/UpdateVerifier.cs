using System.Diagnostics;
using System.Text.Json;

// Checks the Authenticode signature of a downloaded installer. The caller compares the signer
// thumbprint with the one pinned in the app; this class only reports what Windows verified.
static class UpdateVerifier {
    public static object Verify(string path) {
        if (!OperatingSystem.IsWindows()) throw new Exception("UPDATE_VERIFY_UNSUPPORTED");
        var start = new ProcessStartInfo("powershell.exe") {
            RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
        foreach (var arg in new[] { "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
            "$s = Get-AuthenticodeSignature -LiteralPath $env:NX_UPDATE_FILE; " +
            "[pscustomobject]@{ status = $s.Status.ToString(); thumbprint = $s.SignerCertificate.Thumbprint } | ConvertTo-Json -Compress" })
            start.ArgumentList.Add(arg);
        start.Environment["NX_UPDATE_FILE"] = path; // path never reaches the command line
        using var process = Process.Start(start) ?? throw new Exception("UPDATE_VERIFY_FAILED");
        var output = process.StandardOutput.ReadToEnd();
        process.StandardError.ReadToEnd();
        if (!process.WaitForExit(60000)) { try { process.Kill(); } catch { } throw new Exception("UPDATE_VERIFY_FAILED"); }
        if (process.ExitCode != 0) throw new Exception("UPDATE_VERIFY_FAILED");
        using var doc = JsonDocument.Parse(output);
        var status = doc.RootElement.GetProperty("status").GetString() ?? "Unknown";
        var thumbprint = doc.RootElement.TryGetProperty("thumbprint", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString() : null;
        return new { status, thumbprint };
    }
}
