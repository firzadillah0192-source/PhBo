# Basic footer v2 — deployed B revision

Owner approved deployment on 21 October 2026. Active release:
`/srv/photobooth/releases/basic-footer-20261021T090734Z`.
All 16 catalog rows now use unique versioned MinIO references. Commander 001
was previously disabled and is now enabled as requested. Original v1 files and
objects are unchanged; no schema operation or commit was performed.

The B revision retains original medallion mounting/frame detail outside the
renderer’s exact rounded QR footprint (831,1274)-(989,1432), radius10. Only that
footprint is made plain. This avoids the retouch halo of rejected revision A;
it intentionally retains native outer decoration. Blank PNGs contain no QR,
white panel, new border or footer text. The code draws these after generation.
The event plate is cleared with template-specific bounds; Royal Hijab’s floral
tip and lower frame are preserved. Basic lettering is bright ivory, upright Bold
Cormorant with name/date columns and wrapping up to80 characters.

Each directory contains template.png, preview.png, template.json, edit-mask.png
and checksums.json. Fifteen templates stay1024x1536 with unchanged metadata and
pixel-identical v1 surroundings outside masks. Generic Commander keeps its full
1060x1484 source at1010x1414, exact5:7 aspect, offset(7,0), on1024x1536. Its metadata
coordinates are transformed consistently; equality is measured against this
normalized source. It originally has no title, frame or logo; none was invented.

Reproduce offline assets and tests:

```
/srv/photobooth/tmp/event-template-venv/bin/python scripts/prepare_basic_footer_v2.py --validate
/srv/photobooth/tmp/event-template-venv/bin/python -m pytest backend-express/python-worker/test_result_footer.py -q
```

Validation PASS:16 unchanged v1 hashes,16 deterministic PNG rebuilds,64 renders
(short,80-character long,empty,80 unbroken characters),64 QR decodes and actual
glyph bounds checks. Python5 tests+11 subtests; isolated API/worker17 tests each
and compile; frontend115 tests, build and9 viewport browser cases. Contact sheets
are `/srv/photobooth/tmp/basic-footer-v2-review/{all-16-contact-sheet.jpg,v2-contact-sheet.png,rendered-footers.png}`.

A genuine Standard provider job, ac8ce536feb92ac3c263407fe475ce92, completed using
a generated template portrait crop, never a customer photo. Commander001 output
is1024x1536, says Uji Footer NXBooth and21 Oktober2026. Its actual QR decodes and
opens the public /r page, metadata and download; HTTPS download bytes match.
The one validation grant of50AI credits was consumed and audited on an isolated
canary account. Claim expires28October2026, matching the seven-day test plan
retention. claimHours remains24; printed claims follow result retention.

Visual limitation: the AI extended Commander’s scene into its blank bottom
band. The code footer remains readable. Only Commander001 has a full provider
canary; other15 have deterministic render checks, not full AI jobs. Production
must not be described as guaranteeing pixel-identical AI output.

Review gallery (A/B comparison, retained across deployment):
https://nxbooth.gennexbyte.com/previews/basic-footer-v2-r2-20261021-b3af8c784e/

All-lane prompt source was preserved in API and worker. The separately prepared
fast-prompt-20261021T023720Z release was not modified or deployed.

Release manifest, catalog-before/after snapshots, canary.json, canary-final.png,
compose rollback and build/verification logs are in the release directory.
Rollback: `python3 -I scripts/deploy_basic_footer.py rollback` (requires owner
approval). It conditionally restores catalog references/enabled state and the
four previous images. Existing generated results/claims remain intact.

The review galleries and canary PNG were republished to the running web document
root after deploy. Their persistent staging sources are retained under tmp review
published directories. Republish them if the current web image is recreated.
