# NXDuet — proposed upload-your-own companion flow

Status: account ownership, auto-save and 100-credit preparation price confirmed by
the owner. Implementation design remains for review; not implemented or deployed.
No production database changes.

## Product

NXDuet is a separate path from Classic. Users upload an image they have permission
to use, prepare it as a camera companion, and take a three-photo strip. There is no
official idol/anime catalog or implied collaboration. Marketing: “Foto bersama orang
terkasih, meski terpisah jarak.”

## Entry and help

- Proposed entry: `/nxduet`.
- Show “Template saya” and “Buat template baru”.
- Require sign-in for creation and access to saved templates. Templates are private
  and bound to the creating account; another account cannot read/use/delete them.
- If no templates exist, show an empty state with the create action.
- A labelled question-mark help button opens a short guide: select a clear image of
  one subject; ensure permission to use it; avoid cropped heads/hands; prepare and
  review the companion; position yourself beside it in the camera; take three photos.
- Do not request camera access until the user enters the photo session.

## New template

1. Upload and validate the source photo using existing upload safeguards.
2. Obtain the user's statement that they have the necessary rights/permissions.
3. Show “Siapkan template · 100 kredit” before submission. Check available credits,
   reserve 100 atomically, and show “Menyiapkan teman foto” while the backend
   processes a real preparation job. Insufficient balance prevents preparation.
4. Initial proposal: preserve the uploaded pose and appearance, remove the background,
   and produce one reusable transparent cutout. Additional generated poses are a
   separate scope decision: they take extra preparation and require identity review.
5. Validate actual transparency, image readability, and output dimensions. A PNG file
   extension or successful HTTP response alone does not establish a usable cutout.
6. Let the user inspect the result and adjust companion size and left/right placement.
7. Automatically save the successfully prepared template to the creating account,
   with a default editable name. Do not ask whether to save or offer a use-once path.
   Show “Template tersimpan di akunmu”. Do not publish it or create a shared link.
8. Enter the camera session only after the preparation succeeds and is reviewed.
   Closing the page after successful preparation must not lose the saved template.

Preparation errors must show an actual failure and allow retry or replacement upload.
No simulated progress/completion or fallback customer photo presented as AI success.
Preparation latency is unverified; do not promise instant output.

## Credit lifecycle

Confirmed preparation price: 100 credits per new template preparation. This is not
100 credits per camera shot, strip, template opening, or save operation.

Follow existing reserve/settle/refund semantics: reserve at accepted submission,
consume only when a valid prepared template and its owned asset references are
durably saved, and refund failed preparation exactly once. Confirm accounting
integration against the active wallet/subscription path before implementation.
Automatic technical retries and duplicate client submissions must use the same
operation identity and cannot charge again. An explicitly requested new preparation
is a new paid operation with the 100-credit price shown before submission.

Renaming, adjusting placement/size and reusing a saved cutout do not prepare a new
AI asset and therefore do not incur another preparation charge. Deleting a completed
template does not itself refund a successful preparation. No external payment or
top-up provider change is part of this feature.

## Photo session and reuse

- The live camera and companion are visible together before each shot.
- Use the same crop, mirroring, scale, and placement for preview and captured output.
- Capture three photos, permit review/retake, compose a strip, and offer download.
- Camera sessions and strip composition do not call the AI provider. Reopening an
  existing prepared template also does not call AI. Changing the source or generating
  a new pose requires a new preparation operation.
- Saved data includes processed image references and composition settings, not just
  the original upload. A template may only be reusable while its assets still exist.
- No body tracking, animation, or foreground occlusion in the first version.

## Runtime boundaries

Codex builds the feature during development. It is not the customer's runtime AI
service. Production preparation must use the existing backend/worker and configured
provider abstraction; provider cutout quality and transparency need real acceptance.
The built-in image-generation tool used during this conversation is not an app API.

Templates are data/assets, not application source. Once the feature has been deployed
with owner approval, new user templates are processed and loaded as data. They do not
trigger builds, deployments, container changes, or changes to public template catalogs.

Use existing storage infrastructure, provider abstraction, wallet and ownership
controls. Do not introduce a new service/provider or modify production schema as part
of this proposal. Preparation costs 100 credits as confirmed by the owner. Normal
photo composition has no AI call; do not add a per-session fee without an explicit
product decision.

## Account storage and admin control

Confirmed scope: account storage, available across devices after sign-in. Browser-only
storage is not the product requirement. Keep image bytes in existing object storage
and account ownership/asset references/composition metadata in the database.

Admin control is confirmed; proposed minimum controls are listing/filtering templates
by owner and status, inspecting preparation/credit outcomes, disabling/re-enabling
use, and deletion with confirmation. Enforce existing admin role checks server-side
and audit admin actions. Disabled/deleted templates must be rejected by the backend,
including requests from a previously open browser. Do not expose private customer
assets in public catalogs or give ordinary users another account's access.

A reviewed metadata/ownership design and likely additive SQL are required. Drafting
SQL does not authorize applying it to production. Production application requires
explicit approval after backup, per AGENTS.md.

Define retention for the source upload separately from the saved processed cutout;
provide deletion and ensure the normal cleanup job does not break saved templates.

## Acceptance

- Empty and populated entry states, accessible help, and clear automatic-save notice.
- Real upload-to-prepared-cutout flow; failure paths and actual transparent pixels.
- Camera permission denial, camera unavailable, retake, and camera-track cleanup.
- Preview/capture agreement for front-camera mirroring and aspect-ratio cropping.
- Three real camera captures and a downloadable composed strip.
- Reuse persists in the agreed storage scope and makes zero additional AI calls.
- 100-credit reservation/consumption, insufficient balance, failed-preparation refund,
  duplicate requests, worker retries and page-close recovery; no duplicate charges.
- Account ownership, cross-device access, role-restricted admin controls, deletion,
  disable/re-enable and retention tested with synthetic/consented assets.
- Physical camera and real provider acceptance remain required before claiming the
  feature works end to end. Deployment remains a separately approved operation.
