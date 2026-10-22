# Classic event-name background audit — 11 October 2026

Status: PASS. Correction published with explicit owner approval as classic-single-window-20261011T064934Z.

The two latest Classic jobs were `a802948a23960fac50af0e7c4b57670c` (Blue Floral) and `ea27e46e5abb516e23afade1644ffa6f` (Bulan Sabit). Both completed. Only selected job/layout metadata was read; customer photos/results were not modified or downloaded.

All 36 live previews match the local single-window-v4 assets byte-for-byte. The renderer `classic_event_footer.py` matches the live helper and draws text directly; it does not draw a title rectangle.

31 templates retain a flat #073957 area below the photo aperture. Eleven extend into the reserved title band (y=2720..2940). This is an artwork/preparation defect, not a per-job font option. `prepare_classic_personalized_assets.py` flattens old transparent artwork onto #073957; `prepare_classic_single_window.py` cuts the revised aperture only through y=2637, leaving the lower part of old holes visible as a flat rectangle. Small remnants below the aperture are listed separately from title-band overlaps.

| Layout | Name | Flat-fill end y | Overlaps reserved title band |
| --- | --- | --- | --- |
| classic-birthday-002 | Pastel Anak | 2696 | No |
| classic-birthday-003 | Colorful Pop | 2691 | No |
| classic-birthday-004 | Birthday Elegance | 2798 | Yes |
| classic-eid-adha-001 | Geometri Islami | 2690 | No |
| classic-eid-adha-002 | Lentera Malam | 2719 | No |
| classic-eid-adha-003 | Lengkung Harmoni | 2801 | Yes |
| classic-eid-adha-004 | Earth Tone | 2691 | No |
| classic-eid-fitri-001 | Ketupat Anyaman | 2749 | Yes |
| classic-eid-fitri-002 | Bulan Sabit | 2982 | Yes |
| classic-eid-fitri-003 | Floral Silaturahmi | 2666 | No |
| classic-eid-fitri-004 | Silaturahmi Gold | 2822 | Yes |
| classic-frame-002 | Classic Frame 2 | 2684 | No |
| classic-frame-003 | Classic Frame 3 | 2695 | No |
| classic-khitan-001 | Ceria Anak | 2687 | No |
| classic-khitan-002 | Royal Blue | 2682 | No |
| classic-khitan-003 | Petualangan | 2740 | Yes |
| classic-khitan-004 | Tradisional | 2763 | Yes |
| classic-wedding-betawi-001 | Kembang Kelapa | 2689 | No |
| classic-wedding-betawi-002 | Gigi Balang | 2695 | No |
| classic-wedding-betawi-003 | Betawi Cerah | 2664 | No |
| classic-wedding-betawi-004 | Floral Betawi | 2804 | Yes |
| classic-wedding-jawa-001 | Batik Klasik | 2693 | No |
| classic-wedding-jawa-002 | Janur Harmoni | 2694 | No |
| classic-wedding-jawa-003 | Pendopo | 2762 | Yes |
| classic-wedding-jawa-004 | Jawa Cream | 2698 | No |
| classic-wedding-minang-001 | Songket Merah | 2649 | No |
| classic-wedding-minang-003 | Gonjong | 2794 | Yes |
| classic-wedding-minang-004 | Minang Red Gold | 2698 | No |
| classic-wedding-sunda-001 | Melati Putih | 2867 | Yes |
| classic-wedding-sunda-002 | Siger Elegance | 2663 | No |
| classic-wedding-sunda-003 | Floral Hijau | 2680 | No |

Inspection sheets and detailed read-only audit: `/srv/photobooth/tmp/classic-footer-audit/`. These are catalog assets, not customer photographs.

A built-in imagegen edit was attempted for Bulan Sabit with the instruction to remove only the flat panel and preserve the complete strip. It returned 724×2172 instead of the required 1200×3600 and did not preserve the exact alpha geometry. That draft was rejected, not installed or published. No source artwork was replaced.

## Deterministic correction prepared

The owner explicitly authorized Python correction first, with AI only if its result remained unsatisfactory. `scripts/prepare_classic_footer_backgrounds.py` samples each frame's original central footer texture, mirrors and blends it into the old flat-fill remnant, preserving exact alpha and all pixels outside its repair mask. All 36 corrected previews were inspected. This candidate uses no AI edit.

Versioned assets: `backend/app/data/classic-footer-background-v5/`. 31 repaired frames; 5 clean frames retain identical pixels. Historical v4 assets remain intact.

Validation PASS:
- `python -m pytest test_classic_footer_background.py -q`: 2 passed, 36 subtests passed (76.68s), using `/srv/photobooth/tmp/event-template-venv/bin/python` in `backend-express/python-worker`.
- Same interpreter, `python -m pytest test_classic_event_footer.py -q`: 7 passed (2.73s).
- Exact alpha, unchanged photo/header area, unchanged lower footer, all pixels outside the repair mask, and original layout metadata checked. Actual Classic composition with synthetic photos and master/print QR decoding checked for all 36.
- Python compilation, publisher Node syntax, and `git diff --check` passed.

Prepared release: `/srv/photobooth/releases/classic-single-window-20261011T064934Z/`. Includes reviewed assets/checksums, `validation.json`, `comparison.png`, three full inspection sheets, a read-only catalog rollback snapshot `before.json`, and `manifest.json`. Preparation checked all checksums and snapshotted all 36 production catalog rows without writing the catalog.

`scripts/deploy_classic_single_window.py` now accepts the reviewed v5 source on prepare; its default v4 behavior remains. Publication uses the existing versioned MinIO publisher with conditional transactional catalog updates and rollback. No container build/restart or schema change is needed. The release pointer currently selects this prepared release.

Published after the owner replied “lanjut” to the explicit confirmation. All 36 catalog frame references now select the versioned release. 31 artwork fixes are active, 5 clean templates have unchanged pixels. Existing customer results and historical objects are preserved. No commit or push performed; other pre-existing dirty files were left alone.

Post-publication verification PASS:
- Managed deployment verified health and all 36 exact preview matches via web port 3000; all container IDs unchanged.
- Public domain health HTTP 200 and all 36 cache-busted previews exactly match release bytes. Python urllib got HTTP 403; curl successfully verified the normal public URLs.
- Live private helper composed all 36 templates using synthetic photos, checking photo boundaries and metadata. No customer photos or wallet/job records were used.
- Actual helper Bulan Sabit output visually inspected; its 1200×3600 / 600 DPI geometry and result QR decode passed.
- Compose ps passed with the existing helper engine key supplied internally (never printed); expected services running and healthchecks healthy. Recent application logs showed no error lines.

This was an asset-only publication: no container builds/restarts, schema changes, networks, volumes or port changes. Live web remains `photobooth-web:frontend-v2-20261011T062057Z`; API `photobooth-express:classic-event-flow-api-20261010T112140Z`, worker `photobooth-express:classic-event-flow-worker-20261010T112140Z`, helper `photobooth-express:floral-event-helper-20261010T073959Z`.

Preview responses may retain prior artwork for up to one hour in existing caches. New generations use the corrected versioned frame immediately. Rollback is available via `python3 -I scripts/deploy_classic_single_window.py rollback`, using the release pointer and conditional catalog snapshot; any future rollback/publication requires owner approval.

