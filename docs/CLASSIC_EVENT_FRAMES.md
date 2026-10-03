# Classic event frame collection

32 new static frames, retaining the three original layouts (35 total).

| Theme | Designs | 3-photo | 4-photo |
| --- | ---: | ---: | ---: |
| Eid Fitri | 4 | 2 | 2 |
| Eid Adha | 4 | 2 | 2 |
| Khitan | 4 | 2 | 2 |
| Wedding Sunda | 4 | 2 | 2 |
| Wedding Jawa | 4 | 2 | 2 |
| Wedding Betawi | 4 | 2 | 2 |
| Wedding Padang / Minang | 4 | 2 | 2 |
| Ulang Tahun | 4 | 2 | 2 |

All 35 Classic templates now use the frozen 1200 × 3600 (1:3) master and
600 × 1800, 300 DPI print rendition (2 × 6 inches). Each event frame has a
substantial decorative bezel and measured transparent openings, retaining
decorative corners. Photo order is top-to-bottom in one column for both three
and four photographs. See [CLASSIC_STRIP_FORMAT.md](CLASSIC_STRIP_FORMAT.md).

The imagery is event-inspired artwork, not certification of ceremonial or
regional authenticity. The operator should review motifs and a physical test
print before use at a paid event. NXBooth and Powered by GenNexByte lettering is
generated within each new event artwork prompt and reviewed for readability.

## Files and preparation

- Current generated artwork: `import-assets/classic-event-artwork-v2/`.
- Current prompts: `docs/CLASSIC_STRIP_FRAME_PROMPTS.json`.
- Collection plan: `scripts/classic_event_collection.json`.
- Measured, visually reviewed geometry and source hashes:
  `scripts/classic_strip_slots.reviewed.json`.
- Managed transparent masters: `templates/_classic/events/strip-v2/`.
- Small gallery thumbnails: `templates/_classic/events/strip-v2/previews/` (160 × 480).
- Authoritative dimensions, slots, SHA-256 and file sizes:
  `backend/app/data/classic_event_frames.json`.

The operator explicitly authorized Pillow to clean up transparency. Current
branding remains part of the generated artwork. Old artwork remains available.
Preparation requires Pillow,
NumPy and OpenCV locally; this script never calls a provider or production DB.

```sh
python scripts/build_classic_strip_assets.py --inspect
# Review test/output/classic-strip-v2/ contact sheets and measured-slots.json.
python scripts/build_classic_strip_assets.py --review-config scripts/classic_strip_slots.reviewed.json
python scripts/render_classic_event_review.py
```

Artwork geometry was measured from the actual white openings, then visually
checked before assembly. The build rejects unreviewed configs, altered source
hashes, invalid bounds, wrong shot counts and a missing branding footer area.
Runtime uses the existing validated, deterministic Classic compositor and
shared Result/claim/download flow. Classic has zero Advanced credit usage and
no runtime AI/provider call.

Theme metadata lives in the existing `layout_config_json`. No new table or SQL
migration is required. Version 2 seeding upgrades the existing canvas/assets
once and preserves existing names, publication and ordering. Subsequent seeds
preserve operator edits. Admin slot edits preserve the theme metadata.
Catalog validation is cached by complete geometry and asset file stats; asset
replacement or metadata edits invalidate the cached validation. Composition
still validates the actual full-size master. The preview route serves the
small thumbnail only when it is at least as current as the master.

## Review and validation

The earlier 2:3 collection passed 215 backend and 41 frontend tests. Those
counts describe the prior version. The strip correction has additional format
and print-export tests, with results reported after execution. Tests cover all
32 assets, slot alpha/bounds, exact canvas, incorrect capture counts, photo
ordering, pixel preservation, idempotent seeding, disabled-layout handling,
theme retention, shared Result/claim/download and zero AI credits/provider calls.

Browser checks cover desktop, Android, 320px mobile, iPad Chromium and iPad
WebKit/Safari emulation. They exercise all eight filters, 35 catalog entries,
selection clearing, camera entry and selection recovery after refresh.

Synthetic review artifacts (not production assets, not committed):

- `test/output/classic-strip-v2/finished-frame-contact-sheet.jpg`
- `test/output/classic-strip-v2/composite-contact-sheet.jpg`
- `test/output/classic-strip-v2/composites/` — master and print outputs for all 35 layouts.
- `test/output/classic-strip-v2/browser/` — device screenshots/reports.
- Earlier `test/output/classic-events/` artifacts are retained for reference.

Local browser validation:

```sh
cd frontend
NXBOOTH_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node scripts/classic-events-browser-check.mjs
```

## Manual acceptance

Open `/create?mode=classic`. Confirm 35 total frames and four per event theme.
Choose one three-photo frame and one four-photo frame. Confirm the camera
announces the appropriate shot count, offers the existing three shared retakes,
and advances after the existing 10-second photo review. Inspect each finished
photo for subject crop, frame placement, text readability and print output.
Confirm download and Open on Phone/QR work, and Advanced credits stay unchanged.
Real-device camera quality and physical print quality require operator review.
