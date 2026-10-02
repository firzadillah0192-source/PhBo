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

All new master PNGs are 1024 × 1536 (2:3). Each has a substantial decorative
bezel, opaque artwork outside the photo openings, and precisely transparent
rectangular openings. Photo order is top-left, top-right, bottom-left,
bottom-right for four photographs; top-to-bottom for three photographs.

The imagery is event-inspired artwork, not certification of ceremonial or
regional authenticity. The operator should review motifs and a physical test
print before use at a paid event. NXBooth and Powered by GenNexByte are approved
deterministic text, not a fabricated logo.

## Files and preparation

- Original generated artwork: `import-assets/classic-event-artwork/`.
- Offline prompts: `docs/CLASSIC_EVENT_FRAME_PROMPTS.json`.
- Collection plan: `scripts/classic_event_collection.json`.
- Measured, visually reviewed geometry and source hashes:
  `scripts/classic_event_slots.reviewed.json`.
- Managed transparent masters: `templates/_classic/events/`.
- Small gallery thumbnails: `templates/_classic/events/previews/` (320 × 480).
- Authoritative dimensions, slots, SHA-256 and file sizes:
  `backend/app/data/classic_event_frames.json`.

The operator explicitly authorized Pillow to clean up transparency and add
branding. The original artwork remains available. Preparation requires Pillow,
NumPy and OpenCV locally; this script never calls a provider or production DB.

```sh
python scripts/build_classic_event_assets.py --inspect
# Review test/output/classic-events/artwork-contact-sheet.jpg and measured-slots.json.
python scripts/build_classic_event_assets.py --review-config scripts/classic_event_slots.reviewed.json
python scripts/render_classic_event_review.py
```

Artwork geometry was measured from the actual white openings, then visually
checked before assembly. The build rejects unreviewed configs, altered source
hashes, invalid bounds, wrong shot counts and a missing branding footer area.
Runtime uses the existing validated, deterministic Classic compositor and
shared Result/claim/download flow. Classic has zero Advanced credit usage and
no runtime AI/provider call.

Theme metadata lives in the existing `layout_config_json`. No new table or SQL
migration is required. Seeding inserts missing IDs only and preserves existing
admin publication changes. Admin slot edits preserve the theme metadata.
Catalog validation is cached by complete geometry and asset file stats; asset
replacement or metadata edits invalidate the cached validation. Composition
still validates the actual full-size master. The preview route serves the
small thumbnail only when it is at least as current as the master.

## Review and validation

Scoped snapshot: full backend suite 215 passed; full frontend suite 41 passed;
production build, Python compile and `git diff --check` passed. Tests cover all
32 assets, slot alpha/bounds, exact canvas, incorrect capture counts, photo
ordering, pixel preservation, idempotent seeding, disabled-layout handling,
theme retention, shared Result/claim/download and zero AI credits/provider calls.

Browser checks cover desktop, Android, 320px mobile, iPad Chromium and iPad
WebKit/Safari emulation. They exercise all eight filters, 35 catalog entries,
selection clearing, camera entry and selection recovery after refresh.

Synthetic review artifacts (not production assets, not committed):

- `test/output/classic-events/finished-frame-contact-sheet.jpg`
- `test/output/classic-events/composite-contact-sheet.jpg`
- `test/output/classic-events/composites/` — one output for each new layout.
- `test/output/classic-events/browser/` — device screenshots/reports.
- `test/output/classic-events/public/` — public-site gallery screenshots/reports.

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
