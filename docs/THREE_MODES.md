# Three-mode implementation contract

This checkout adds Classic, framed Basic, and art-directed Advanced without deploying them. The uploaded source PNGs remain in `import-assets/`. Managed seed copies live in `templates/` and are copied into the runtime template store at application startup without replacing an existing managed asset.

## Reviewed assets

| Asset | Canvas | Ratio | Alpha | Fully transparent pixels | Partial alpha pixels | Bytes | SHA-256 |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| `basic-withframe1.png` | 1024×1536 | 2:3 | none, RGB | 0 | 0 | 2,913,145 | `ac471e7913d173f5edeecf3a28980b790821d2b6aeb5a4e96f15ba91270d39e6` |
| `classic-frame1.png` | 724×2172 | 1:3 | RGBA | 1,154,156 | 415,718 | 561,833 | `0241000b682fca757dc0840402286d975cbd560391242ec91607326c6c56b0cc` |
| `classic-frame2.png` | 724×2172 | 1:3 | RGBA | 972,023 | 600,297 | 896,901 | `bcd429cab98aaac88b6b0c1ec1e07f490a0d7c6bad8078d9eaaff0783d63c084` |
| `classic-frame3.png` | 724×2172 | 1:3 | RGBA | 989,489 | 581,823 | 976,902 | `b0bf20ffe8870894f3e0d82a80971529a75a27a0c75a45120eff56d5d3ea1102` |

The Classic slot rectangles are the bounding boxes of the enclosed fully transparent regions. Transparent exterior background and isolated narrow transparent lines were excluded. The compositor places photographs behind the PNG, so rounded openings and decorative edges stay intact.

| Layout | Shot count | Slots `(x, y, width, height)` |
| --- | ---: | --- |
| `classic-frame-001` | 4 | `(93,87,540,429)`, `(94,567,539,430)`, `(94,1050,539,428)`, `(94,1531,539,397)` |
| `classic-frame-002` | 4 | `(114,132,501,384)`, `(112,596,503,384)`, `(112,1060,505,377)`, `(114,1513,501,383)` |
| `classic-frame-003` | 3 | `(94,151,548,466)`, `(94,695,548,466)`, `(94,1240,548,471)` |

The Basic PNG already contains its title, costume, scene, footer, and NXBooth branding. Its alpha channel is absent. The new manifest limits identity processing to the measured face area; its canvas remains 1024×1536.

## Customer API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/classic/layouts` | Enabled, validated layout metadata and preview URLs. |
| GET | `/api/classic/layouts/{id}/preview` | Frame PNG. |
| GET | `/api/advanced/frame-styles` | Enabled style names and descriptions; private prompt fragments stay server-side. |
| GET | `/api/advanced/ornaments` | Enabled ornament names and descriptions. Empty ornament ID list means None. |
| POST | `/api/generations` | Classic: `mode`, `layout_id`, `upload_id`, `capture_upload_ids`. Basic: `mode`, `template_id`, `upload_id`. Advanced: `mode`, `experience_id`, `frame_style_id`, `ornament_ids`, `upload_id`. Returns a queued shared job. |
| GET | `/api/generations/{id}` | Shared job state plus selected layout/style/ornament IDs. |
| GET | `/api/results/{id}` | Shared result metadata and image/download URLs. |
| POST | `/api/results/{id}/claim` | Existing shared QR and phone claim. |

Invalid Classic layouts, captures, Advanced style IDs, compatibility, and ornament count return 422; unknown or unavailable layouts return 404. Classic does not reserve AI credits or call the provider. Advanced reserves and settles one existing business credit per successful job. Basic retains its prior business rule.

Admin endpoints under `/api/admin` provide Classic layout list/create/patch and frame upload, Advanced frame style and ornament list/create/patch, and Experience compatibility/max ornament editing through the existing Experience endpoint. Basic admin metadata now shows framed status, canvas dimensions, reduced aspect ratio, and enabled status.

## Output and deployment boundary

Classic output exactly matches its 724×2172 frame and remains a PNG. Advanced sends the composed prompt through the existing provider abstraction with its current 1024×1024 request. A read-only query of the configured 9Router model-info endpoint returned HTTP 200 and listed `size` as a parameter, but supplied no allowed size values. [9Router's image documentation](https://github.com/decolua/9router/blob/master/skills/9router-image/SKILL.md) describes that endpoint and notes provider-dependent size handling. The returned image is placed without stretching on a 2160×3240 master over a blurred crop background, then application-owned branding is applied. There is no verified support for a native 2160×3240 request. A standalone approved logo asset was not found; the branding layer can load `templates/_branding/nxbooth-logo.png` when supplied and currently uses plain deterministic text for NXBooth and Powered by GenNexByte. Optional event name and date are supported by the branding function but have no event input wired into this customer flow.

Migration `012_three_modes.sql` must follow the already present `011_kiosk_events_classic.sql` if `011` has not been applied. The migration was checked on disposable PostgreSQL, including a second idempotent application. No production database or service was changed.

When deployment is later authorized, apply the required unapplied migrations, then rebuild `photobooth-api`, `photobooth-worker`, and `photobooth-web`. The PostgreSQL and Redis images do not need a rebuild. Verify managed asset seeding, `/api/health`, each catalog endpoint, one synthetic Classic job, shared claim/download, a Basic face test under operator review, and an Advanced provider test with credit settlement. Review the three files under `test/output/` before publication.
