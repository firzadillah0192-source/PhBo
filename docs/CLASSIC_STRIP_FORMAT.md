# Frozen Classic strip format

All Classic templates share `classic-strip-2x6-v1`:

| Output | Pixels | DPI | Physical size |
| --- | --- | --- | --- |
| Working/result master | 1200 × 3600 | 600 | 2 × 6 inches |
| Print download | 600 × 1800 | 300 | 2 × 6 inches |

The authoritative profile is `backend/app/data/classic_print_profile.json`.
Publishing a Classic layout with another master canvas is rejected by Admin.
Classic alone uses this 1:3 profile; Basic and Advanced retain their formats.

## Original and event templates

Original Frames 1–3 are all 724 × 2172 RGBA (1:3), with 4, 4 and 3 shots.
Their original files remain unchanged. Uniformly resized versions and scaled
reviewed slot metadata live in `templates/_classic/original-masters/` and
`backend/app/data/classic_original_strip_frames.json`.

The 32 event frames use one vertical column of three or four photo openings.
Their versioned masters live in `templates/_classic/events/strip-v2/`, alongside
small previews and print renditions. AI-generated source artwork is preserved
in `import-assets/classic-event-artwork-v2/`. Generated sources may have fewer
pixels than the working master; upscaling does not add original detail.

NXBooth and Powered by GenNexByte are requested verbatim in each artwork prompt,
with lettering and materials adapted to its event theme. The preparation script
does not draw generic replacement branding. Pillow performs uniform sizing and
precise transparency, retaining decorative corners. Geometry and branding must
be reviewed before the build accepts `scripts/classic_strip_slots.reviewed.json`.

```sh
python scripts/build_classic_original_masters.py
python scripts/build_classic_strip_assets.py --inspect
python scripts/build_classic_strip_assets.py --review-config scripts/classic_strip_slots.reviewed.json
python scripts/render_classic_event_review.py
```

## Catalog upgrade and delivery

Existing Classic IDs are retained. Catalog seeding performs a one-time version 2
format upgrade, preserving names, publication state and ordering. Subsequent
seeding leaves operator edits intact. No SQL migration or new Result table is
required. Old assets and already generated Results remain available.

The existing compositor uses cover cropping and saves Classic masters with 600
DPI metadata. Shared owned and QR Result downloads expose an optional
`?rendition=print` export for 1:3 Classic results. The export is 600 × 1800 PNG at
300 DPI, uses the existing authorization/claim limits, and never calls AI or
charges credits. The default download remains the master. Other modes reject
the strip export. Existing non-strip Classic results do not advertise it.

## Acceptance

Review `test/output/classic-strip-v2/` contact sheets and synthetic composites.
Check all 35 frames, correct shot counts, a single column, transparency, themed
NXBooth text, and subject cropping. Generate a three-shot and four-shot result;
download both master and print renditions, and test the same print export on the
QR page. Confirm dimensions/DPI and unchanged Advanced credits. Test a physical
2 × 6 inch print with printer scaling disabled before event use. Motifs are
event-inspired artwork and do not certify regional ceremonial authenticity.
