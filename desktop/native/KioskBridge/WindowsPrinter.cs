using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Printing;
using System.Runtime.Versioning;

internal static class PrintLayout
{
    public static float[][] Plan(string profile, int width, int height)
    {
        if (width <= 0 || height <= 0 || (long)width * height > 25000000) throw new Exception("PRINT_IMAGE_INVALID");
        if (profile == "classic-two-strips-4r")
        {
            if (!((width == 1200 && height == 3600) || (width == 600 && height == 1800))) throw new Exception("PRINT_CLASSIC_SIZE_INVALID");
            return [[0, 0, 200, 600], [200, 0, 200, 600]];
        }
        if (profile != "photo-4r") throw new Exception("PRINT_PROFILE_INVALID");
        // Fit the entire result inside 4R; never silently crop AI output.
        var scale = Math.Min(400f / width, 600f / height);
        var w = width * scale; var h = height * scale;
        return [[(400-w)/2, (600-h)/2, w, h]];
    }
}

[SupportedOSPlatform("windows")]
internal static class WindowsPrinter
{
    private static readonly string[] Virtual = ["pdf", "xps", "onenote", "fax", "anydesk", "virtual", "document writer"];

    // Prefer the Epson L8050, then any Epson, then the Windows default, then any physical printer.
    private static PrinterSettings Settings()
    {
        var configured = Environment.GetEnvironmentVariable("PHBO_PRINTER_NAME");
        var all = PrinterSettings.InstalledPrinters.Cast<string>().ToArray();
        var physical = all.Where(n => !Virtual.Any(v => n.Contains(v, StringComparison.OrdinalIgnoreCase))).ToArray();
        string? name = null;
        if (!string.IsNullOrWhiteSpace(configured)) name = configured;
        else
        {
            var l8050 = physical.Where(n => n.Contains("L8050", StringComparison.OrdinalIgnoreCase)).ToArray();
            if (l8050.Length == 1) name = l8050[0];
            else if (l8050.Length > 1) throw new Exception("PRINTER_SELECTION_REQUIRED");
            else
            {
                var epson = physical.Where(n => n.Contains("EPSON", StringComparison.OrdinalIgnoreCase)).ToArray();
                var def = new PrinterSettings();
                name = epson.Length >= 1 ? epson[0]
                    : def.IsValid && physical.Contains(def.PrinterName) ? def.PrinterName
                    : physical.FirstOrDefault();
            }
        }
        if (name == null) throw new Exception("PRINTER_NOT_CONNECTED");
        var settings = new PrinterSettings { PrinterName = name, Copies = 1, Collate = false };
        if (!settings.IsValid) throw new Exception("PRINTER_NOT_CONNECTED");
        return settings;
    }

    public static object Status()
    {
        try { var settings = Settings(); return new { printer = "READY", printerName = settings.PrinterName, profiles = new[] { "classic-two-strips-4r", "photo-4r" } }; }
        catch (Exception e) { return new { printer = System.Text.RegularExpressions.Regex.IsMatch(e.Message, "^[A-Z0-9_]+$") ? e.Message : "PRINTER_UNAVAILABLE", printerName = (string?)null, profiles = Array.Empty<string>() }; }
    }

    // Anything that is not a coded error was raised before the job reached the spooler (printer lookup, paper, image), so nothing was sent.
    // After the receipt is written only coded errors can escape, which keeps an ambiguous outcome distinct (PRINT_OUTCOME_UNKNOWN).
    public static object Submit(string path, string jobId, string root, string profile)
    {
        try { return SubmitCore(path, jobId, root, profile); }
        catch (Exception e) when (!System.Text.RegularExpressions.Regex.IsMatch(e.Message, "^[A-Z0-9_]+$")) { throw new Exception("PRINTER_UNAVAILABLE"); }
    }

    private static object SubmitCore(string path, string jobId, string root, string profile)
    {
        var settings = Settings();
        var paper = settings.PaperSizes.Cast<PaperSize>()
            .Where(p => Math.Abs(p.Width - 400) <= 2 && Math.Abs(p.Height - 600) <= 2)
            .OrderByDescending(p => p.PaperName.Contains("borderless", StringComparison.OrdinalIgnoreCase)).FirstOrDefault();
        if (paper == null) throw new Exception("PRINT_4R_PAPER_UNAVAILABLE");
        using var image = Image.FromFile(path);
        var positions = PrintLayout.Plan(profile, image.Width, image.Height);
        using var document = new PrintDocument { PrinterSettings = settings, DocumentName = "NXBooth-" + jobId, PrintController = new StandardPrintController() };
        document.DefaultPageSettings.PaperSize = paper;
        document.DefaultPageSettings.Landscape = false;
        document.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
        var printable = document.DefaultPageSettings.PrintableArea;
        if (printable.Width < 398 || printable.Height < 598 || document.DefaultPageSettings.HardMarginX > 1 || document.DefaultPageSettings.HardMarginY > 1)
            throw new Exception("PRINT_ENABLE_4R_BORDERLESS");
        document.PrintPage += (_, page) => {
            if (page.Graphics == null) throw new Exception("PRINT_GRAPHICS_UNAVAILABLE");
            page.Graphics.PageUnit = GraphicsUnit.Display;
            page.Graphics.TranslateTransform(-page.PageSettings.HardMarginX, -page.PageSettings.HardMarginY);
            page.Graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            foreach (var box in positions) page.Graphics.DrawImage(image, new RectangleF(box[0], box[1], box[2], box[3]));
            page.HasMorePages = false;
        };
        // Persistent receipt is created before any side effect. A crash or an
        // ambiguous driver error must never cause an automatic second print.
        var receipt = Path.Combine(root, "print-" + jobId + ".receipt");
        try { using var stream = new FileStream(receipt, FileMode.CreateNew, FileAccess.Write); }
        catch (IOException) { throw new Exception("PRINT_ALREADY_SUBMITTED"); }
        try { document.Print(); File.WriteAllText(receipt, "ACCEPTED"); }
        catch { throw new Exception("PRINT_OUTCOME_UNKNOWN"); }
        return new { jobId, status = "ACCEPTED", printerName = settings.PrinterName, simulated = false };
    }
}
