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
    private static PrinterSettings Settings()
    {
        var configured = Environment.GetEnvironmentVariable("PHBO_PRINTER_NAME");
        var names = PrinterSettings.InstalledPrinters.Cast<string>().Where(name => name.Contains("L8050", StringComparison.OrdinalIgnoreCase)).ToArray();
        var name = !string.IsNullOrWhiteSpace(configured) ? configured : names.Length == 1 ? names[0] : null;
        if (name == null) throw new Exception(names.Length > 1 ? "PRINTER_SELECTION_REQUIRED" : "PRINTER_NOT_CONNECTED");
        // This release is calibrated for the approved Epson model only.
        if (!name.Contains("L8050", StringComparison.OrdinalIgnoreCase)) throw new Exception("PRINTER_MODEL_UNSUPPORTED");
        var settings = new PrinterSettings { PrinterName = name, Copies = 1, Collate = false };
        if (!settings.IsValid) throw new Exception("PRINTER_NOT_CONNECTED");
        return settings;
    }

    public static object Status()
    {
        try { var settings = Settings(); return new { printer = "READY", printerName = settings.PrinterName, profiles = new[] { "classic-two-strips-4r", "photo-4r" } }; }
        catch (Exception e) { return new { printer = e.Message, printerName = (string?)null, profiles = Array.Empty<string>() }; }
    }

    public static object Submit(string path, string jobId, string root, string profile)
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
