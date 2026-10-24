# NXDuet API — production release 2026-10-24

Production entrypoints: Express migration API/worker. `NXDUET_ENABLED=false` by
default. Enabling requires subscription wallet v2, migration 028 and private asset
storage. It must not be enabled before both API and worker versions are prepared.
Production release `nxduet-20261024T093735Z` enables it on both services. Client
library/pending-request binding uses the existing `/api/account/me` `analytics_id`;
that response does not contain an `id` field. Backend ownership always comes from
the authenticated account session, never from this browser binding.

## Customer

All operations except capabilities require an active signed-in account. Guest and
integration API keys cannot access these routes. Responses/assets are private and
no-store; source paths, prompt, provider/model and operational metadata are excluded.

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/api/nxduet/capabilities` | `{enabled,preparation_credits:100}`; available while feature is off |
| GET | `/api/nxduet/templates?offset=0` | `{templates,preparation_credits:100}`; newest first, 50 per page, owner only; excludes deleted |
| POST | `/api/nxduet/templates` | 202 template metadata. Body `{upload_id,name,rights_accepted:true}`; required `Idempotency-Key`, 16–100 ASCII letters/digits/underscore/hyphen |
| GET | `/api/nxduet/templates/:id` | Current durable state and metadata; allows polling failed/pending/disabled owned templates |
| PATCH | `/api/nxduet/templates/:id` | `{name?,placement?:{side:'left'|'right',scale:0.4..1}}`; completed, enabled owner template only; no preparation charge |
| DELETE | `/api/nxduet/templates/:id` | 204; owner soft deletion; unavailable immediately, physical files removed by worker; rejects active preparation |
| GET | `/api/nxduet/templates/:id/image` | PNG cutout; completed/enabled owner template only, no public/signed delivery |
| POST | `/api/nxduet/templates/:id/compose` | Multipart with exactly three `captures` files and JSON-string `placement`; PNG attachment, `nxduet-photo-strip.png`; no AI/preparation charge |

`upload_id` is an existing validated owned upload. Template IDs are 32 lowercase hex
characters. Names are trimmed, 1–80 characters. Unknown JSON fields, invalid names,
IDs, placement, rights acknowledgement or request keys return 422. Client-supplied
price/model/prompt fields are rejected.

Template metadata: `{id,name,state,enabled,placement,credits:100,charge_status,width,
height,size_bytes,error_code,created_at,updated_at,image_url}`. States are
`QUEUED/PROCESSING/COMPLETED/FAILED`; charge statuses are
`RESERVED/CONSUMED/REFUNDED`. `image_url` is null unless completed/enabled/nondeleted.
There is no simulated completion or percentage.

Creation copies the source to the private template namespace before durable enqueue.
Wallet hold and template row are committed atomically under the existing account
wallet lock. Same account/key/body reuses the operation even after completion or
failure; different body returns 409 `IDEMPOTENCY_CONFLICT`. A replay of a deleted
template returns 410 `NXDUET_DELETED`. Retry after a lost response uses the same key;
explicitly creating another preparation uses a new key and another 100-credit hold.

The existing worker polls pending preparations and claims using a PostgreSQL lease.
It renews every 15s. Valid transparent PNG assets must be durably saved before
consumption/completion. Provider failure, corrupt/opaque/empty results or interrupted
preparation fail/refund exactly once. Two-minute expired processing leases and
30-minute queued timeouts are recovered without another paid provider call. An
ambiguous completion keeps the output for durable-state reconciliation.

Credits use the existing subscription-monthly-first, then top-up allocation.
Refunds restore original **unexpired** monthly allocations and top-up amounts;
monthly credits from a period that expired during preparation do not revive. Wallet
history includes holds/refunds, usage totals include consumed NXDuet charges, and
storage accounting includes template/source bytes plus pending output reservations.

The prepared cutout is auto-saved privately to its account; no save prompt. Placement
is saved before the first camera capture. Camera and reusable templates make no new
AI request. Each composed strip is returned directly for download; it is not added
to the existing result library/QR/folder system. Images from the camera are not
persisted by this endpoint. No sharing, animation, body tracking or occlusion.

Composition validates MIME/extension, decodability, size/dimensions and exactly three
captures. Accepted capture formats: JPEG, PNG, WebP. Each file uses the configured
upload limit (12MB default); input pixels limited to 16 million. Output is a
1300×3000 PNG with three 1200×900 photos. Browser preview and server use identical
overlay sizing/anchoring; the camera image is center-cropped and mirrored before
upload. Permission denial and track termination are handled in the UI.

Original temporary uploads retain existing upload-retention rules. The preparation
source copy is removed after completion/failure; the processed cutout remains until
the user/admin deletes it. Source/overlay bytes stay in existing storage, never in
PostgreSQL. Private object paths are `uploads/nxduet/<id>/source.jpg` and
`results/nxduet/<id>/overlay.png`, under the existing allowed storage roots. NXDuet
signed delivery is rejected; image delivery requires the account/admin API session.
No public catalog publication, source-image download or per-template
build/deploy takes place.

Common errors: 401 `AUTHENTICATION_REQUIRED`; 404 `NXDUET_NOT_FOUND` for another
account/missing/deleted template; 409 `NXDUET_UNAVAILABLE` for disabled/not-ready
assets or sessions, `NXDUET_PREPARATION_ACTIVE` for active deletion, or
`STORAGE_QUOTA_EXCEEDED`; 403 `CREDIT_BALANCE_EXHAUSTED`; 503
`AI_PROVIDER_NOT_CONNECTED` before charging if unavailable. Errors use the existing
Express `{detail:{error_code,message}}` envelope. Feature off leaves only capabilities
mounted; other routes return 404. Rate limits: 120 requests/minute per API instance/IP;
creation and composition each additionally limited to 10/minute.

## Admin

Existing admin sessions and role checks apply. Only operator/superadmin may access
private user assets or controls; content managers are denied. All mutations are
audited in the existing audit log with actor, target and mandatory reason.

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/api/admin/nxduet/templates?account_id=&offset=0` | 50 newest templates including disabled/deleted; optional exact account filter. Metadata additionally includes `account_id,deleted_at` |
| GET | `/api/admin/nxduet/templates/:id/image` | Private PNG for inspection, including disabled but excluding deleted |
| POST | `/api/admin/nxduet/templates/:id/control` | `{action:'enable'|'disable'|'delete',reason}`; reason 3–500 characters; `{ok:true}` |

Active preparations cannot be disabled/deleted until terminal; this avoids racing a
paid in-flight request. Deletion of a completed template does not refund its consumed
credits. Disabling/deleting blocks new image reads, captures and server composition;
already delivered image bytes cannot be recalled from a browser.
