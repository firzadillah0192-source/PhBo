# Fast Basic prompt revision — prepared, not deployed

Owner requested a prompting fix for the API/Fast route. Visual reference is the
Aviation Captain output through Codex, not Royal Nusantara. Recent Sunburst
output 837213a24dee947124cd43613d2b8760 retains the template but the face has dark
eye shading and does not achieve the desired rendering. No new visual success
has been claimed.

Changes:
- New `backend-express/src/services/fast-basic-prompt.service.ts`: explicit roles
  for Image 1 (finished portrait) and Image 2 (identity shape cues). Requests
  scene-specific face re-rendering, light direction/fill/exposure/color matching,
  recomputed facial shadows, readable eyes and natural continuous transitions.
  Preserves template hairstyle/head scale, broad proportions, body/neck, frame,
  wording and eyewear rules. No scene-specific warm-light assumption is baked in.
- `customer-generation.service.ts`: one import and one prompt expression. New
  BASIC Fast jobs freeze the new prompt at creation. Standard/default/Codex and
  Advanced use their current composers. The worker sends the frozen snapshot;
  saved jobs and idempotent retries are not rewritten.
- Existing working-tree edits to customer-generation.service.ts were retained.
  Own delta recorded in `scripts/patches/fast_basic_prompt_snapshot.patch`.
- No routing, model, quality, credits, photos, credentials, schema, web or gateway
  changes. Fast remains openai/gpt-image-2.5-sunburst / 100 credits / Low; Standard
  remains cx/gpt-image-2.5 / 50.

Prompting reference: [OpenAI image prompting](https://developers.openai.com/api/docs/guides/image-prompting),
particularly explicit input roles, edit boundaries and preservation requirements.
This informs the prompt design, not a guarantee of image quality.

Validation:
- `node --import tsx --test test/fast-basic-prompt.test.ts`: 3 PASS. Covers frozen
  Fast Basic versus unchanged Standard/default, unchanged Fast Advanced, retry
  preservation and no repeated work.
- `npm run typecheck`: PASS.
- `npm test`: 295 PASS, 1 skipped, 0 failed.
- `npm run build`: PASS (Prisma client generation only; no SQL migration).
- `scripts/deploy_fast_prompt.py prepare`: PASS. It copies each live API/worker
  source, applies only the import and expression substitution, adds the new
  composer, compiles and runs the 3 scoped tests against that isolated baseline,
  then patches those two files and compiled artifacts onto each running image.
  Existing undeployed footer/source work is not shipped.
- `scripts/snapshot_express_compose.py validate`: PASS before preparation.
- No paid generation or visual quality acceptance test was run.

Persistent release is recorded at `/srv/photobooth/releases/.fast-prompt-current`;
its manifest lists image tags, old tags, container IDs and rollback definitions.
Deploy/rollback use `python3 -I scripts/deploy_fast_prompt.py deploy|rollback` and
require fresh owner approval. They affect only API and worker; no 9Router service
restart/sudo is needed. New jobs created after rollout use the new prompt.

Status PARTIAL: source/tests/isolated images are ready, but no deploy approval or
visual validation. All task changes remain uncommitted. The running production
release remains fast-router-20261020T073712Z.

## Deployment completed — 2026-10-20T08:00:54Z

Owner explicitly approved this deployment. Active release:
`/srv/photobooth/releases/fast-prompt-20261020T075843Z/manifest.json`.
API `photobooth-express:fast-prompt-20261020T075843Z`; worker
`photobooth-express:fast-prompt-20261020T075843Z-worker`.
Web/helper/gateway and production routing configuration were not redeployed.

Post-deploy verification PASS:
- API healthy, worker running, zero restarts; startup logs clean.
- Local web and public HTTPS health OK; /create through web returns HTTP 200.
- Compose snapshot regenerated and validated PASS.
- Active routing: Standard cx/gpt-image-2.5 / 50 / Low; Fast
  openai/gpt-image-2.5-sunburst / 100 / Low. Reference validation PASS.
- Executed the compiled customer-generation service in each active API/worker
  container with in-memory model/queue/provider fixtures: Fast Basic freezes the
  new prompt; Standard/default Basic retain the existing prompt. No DB writes,
  customer image access or paid provider generation in this runtime check.

Prompt applies to newly created Fast Basic jobs. Historical and queued snapshots
are retained. Actual visual quality is still untested until a new real generate.
Source remains uncommitted. Rollback:
`python3 -I scripts/deploy_fast_prompt.py rollback` (owner approval required).

## Revision 2 — full-face rendering, prepared only

Owner asked to try the full-face revision after job
`9974c3e53ed10acfe148eff230377e85` still showed inconsistent cheek/jaw shading.
That job was confirmed to have the first Fast-specific prompt (not an old cached
prompt). Viewed actual output, frozen Aviation template, and that job's upload.
The first revision does not yet satisfy the visual target.

Only the Fast composer text changes: edit the whole visible face, explicitly
including forehead/eyelids/cheeks/nose/mouth/jaw/chin as one connected surface.
Template actor facial shading is editable; neither old actor cheek/jaw contours
nor source-photo shadow patches should be retained beneath the new face. Match
the template scene light while keeping natural anatomical depth; no flat uniform
brightening, smoothing mask, or disconnected feature patches. Marker:
`FULL-FACE IDENTITY EDIT` at the beginning of a new frozen job prompt.

`deploy_fast_prompt.py prepare` now supports both initial installation and later
composer-only revisions. When Fast prompt selection is already present in the
live source it is validated and retained, not patched twice. Live source remains
the build baseline; unrelated working-tree changes are not copied.

Validation: 3 scoped tests PASS; backend typecheck PASS; npm test 295 PASS / 1
skipped / 0 failed; backend build PASS; isolated API/worker compile, snapshot tests
and image preparation PASS. New prepared release is pointed to by
`/srv/photobooth/releases/.fast-prompt-current` (manifest stores exact tags and
rollback to revision 1). No deployment, production record mutation, commit or
paid generation was performed for revision 2. Production remains revision 1
`fast-prompt-20261020T075843Z` until separately approved deployment.

## Revision 2 deployed — 2026-10-20T08:12:15Z

Owner explicitly approved deployment. Active API image:
`photobooth-express:fast-prompt-20261020T080928Z`; worker image uses the same tag
with `-worker`. Manifest and rollback to revision 1 are in
`/srv/photobooth/releases/fast-prompt-20261020T080928Z/`.

Verification PASS: API healthy; worker running; zero restarts and clean startup
logs. Local/public health and web/create checks passed in deployment script.
Snapshot regenerate+validate PASS. Compiled code in both active containers passed
in-memory job-creation checks: Fast Basic snapshots begin FULL-FACE IDENTITY EDIT;
Standard/default prompts retain the previous composer. Routing/reference checks
PASS: Fast Sunburst100 Low and Standard cx50 Low. Web/helper/gateway untouched.
No paid generation or customer-photo test was performed, so actual improvement
in cheek/jaw rendering is still unverified. Only newly created Fast Basic jobs
use revision 2; historical results and existing frozen snapshots are unchanged.
Source remains uncommitted.

## Revision 3 — restore strict template contour, prepared only

Reviewed revision-2 output job `504a9a929aea506f47e1bf9276db6eee` and its source.
It used FULL-FACE IDENTITY EDIT and widened/rounded the face relative to the
narrow Aviation template. Owner explicitly clarified that widening is wrong;
the face must fit the template shape. Revision 2 is not visual acceptance.

Fast composer revision 3 locks the Image 1 facial outline and geometry: temple,
cheekbone, cheek and jaw widths/angles and chin width/length. Image 2 supplies eye,
brow, nose and lip cues inside the template contour. No source cheek fullness or
jaw-outline transfer. Removed full-face geometry reconstruction, "rebuild volume"
and ambiguous "broad facial proportions" wording. Lighting may be corrected
continuously across the face without changing geometry. Prompt marker:
`IDENTITY EDIT WITH LOCKED TEMPLATE CONTOUR`.

No model, quality, credits, route, Standard/Codex, Advanced or photo changes.
Typecheck, backend build and npm test PASS (295 pass / 1 skip / 0 fail); scoped
snapshot tests 3 PASS. Isolated live-source API+worker builds/tests and compose
config PASS. Prepared release `fast-prompt-20261020T081854Z`; rollback baseline is
currently live revision 2, `fast-prompt-20261020T080928Z`.

Revision 3 is not deployed, committed or visually validated. Production still
uses revision 2 pending new explicit deploy approval. No paid generation was run.

## Revision 3 deployed — 2026-10-20T08:23:20Z

Owner explicitly approved deployment. API image
`photobooth-express:fast-prompt-20261020T081854Z`; worker image same with `-worker`.
Persistent release/rollback manifest:
`/srv/photobooth/releases/fast-prompt-20261020T081854Z/manifest.json`.

Verification PASS: API healthy, worker running, clean startup logs, 0 restarts;
local/public health and web/create passed; compose snapshot regenerated/validated.
Compiled runtime checks in both active containers confirm the prompt starts
IDENTITY EDIT WITH LOCKED TEMPLATE CONTOUR and new Fast Basic snapshots use it.
Standard/default Basic retains its prior prompt. Routing still Sunburst100 Low,
cx50 Low; gateway reference check PASS. No web/helper/gateway/config/schema change.
No paid generation or new image-quality acceptance test; contour preservation is
an active instruction, not a visually proven guarantee. Existing results remain
unchanged. Source remains uncommitted; unrelated prior dirty work retained.

## Revision 4 — eye illumination, source only

Owner requested a correction after reviewing revision-3 job
`8df0b76d676c1d748cb6c5293eb2c5e8`. Its frozen prompt confirms revision 3;
result still has dark eyelid/eye-socket/under-eye shading compared with the
Aviation template. Similar overhead-light shading is visible in the source
photo. Transfer of source illumination is a visual hypothesis, not a proven
provider-internal cause.

Changed only `src/services/fast-basic-prompt.service.ts`: explicit EYE LIGHTING
PRIORITY separates source eye/brow shape from source exposure and illumination.
Eye, eyelid and under-eye visibility should follow the template lighting;
source-derived gray/brown shadow bands should be relit even when continuous.
Natural folds, iris color and eye shape stay intact; no eye enlargement,
artificial opening, skin whitening or glow. Existing template contour locks
remain. Replaced the ambiguous instruction to retain natural shadows/remove
only mismatched patches with template-supported shading. New marker:
`IDENTITY EDIT WITH LOCKED TEMPLATE CONTOUR AND TEMPLATE EYE LIGHTING`.

Validation PASS: typecheck; backend build; npm test (295 pass, 1 skip, 0 fail);
explicit Fast snapshot tests (3 pass); git diff --check. These checks establish
snapshot isolation and compilation, not image quality. No new paid generation,
photo modification, deployment, image preparation or commit. Model/quality stay
Sunburst/low; no routing, credit, Standard or Advanced changes.

Production remains revision 3: API
`photobooth-express:fast-prompt-20261020T081854Z` and worker same tag with `-worker`.
Revision 4 needs isolated release preparation and explicit owner deploy approval.
After deployment, compare a new result using the same template/source for eye
illumination, retained eye identity, and unchanged narrow template contour.
Other agents' dirty work remains untouched.

## Revision 4 deployed — 2026-10-20T08:33:08Z

Owner explicitly approved deployment. Active API image:
`photobooth-express:fast-prompt-20261020T083233Z`; worker uses same tag with
`-worker`. Release manifest, compose and rollback to revision 3 are under
`/srv/photobooth/releases/fast-prompt-20261020T083233Z/`.

Deployment verification PASS: isolated live-source builds and 3 snapshot tests
per image; compose config; refreshed snapshot validate; API healthy, worker
running, zero restarts and clean startup logs; local/public health and real web
port /create request; Fast/Standard routing and gateway reference validation.
Compiled code in both containers confirms the TEMPLATE EYE LIGHTING marker;
in-memory job creation confirms the new Fast snapshot and preserved
Standard/default composer. Sunburst/low remains active. Web/helper/gateway,
credits and database schema unchanged. No paid generation or photo mutation.
Actual eye-lighting improvement still requires a new result review. Historical
jobs keep their frozen prompt. All source remains uncommitted; unrelated dirty
files retained.

## Revision 4 visual review — not accepted

Owner reports worse output. Read-only review of latest completed job
`b11cb1f63fd1c0a5e69a4c6c1d167438` confirms the revision-4 frozen prompt and
Aviation template. Compared result with its actual upload, revision-3 output
and the previously preferred Codex Aviation result. Eye-area shading and a
sideward/downward-looking gaze remain; facial feature proportions/expression
still do not form a convincing match to the desired portrait. Revision 4 is
not visual acceptance. New upload differs from revision-3 upload, so these two
jobs do not isolate prompt causality. No new code change, deploy, rollback,
paid generation or photo mutation during this review. Production remains
revision 4. Any next intervention should be validated with identical source
and template before another production rollout; repeated prompt additions
have not established improvement.

## Revision 5 — source whole-face foundation, source only

Owner explicitly changed the concept after rejecting prior outputs: use the
complete source face, then edit it to fit template styling (for example a
slimmer face and brighter skin). This supersedes earlier exact template facial
contour requirements for Fast Basic.

Replaced the Fast composer with SOURCE FACE PORTRAIT WITH TEMPLATE STYLING.
Image 2 supplies the coherent whole face, including forehead, cheeks, jaw and
chin plus recognizable feature relationships. Image 1 guides pose, head scale,
hairstyle, retouching, lighting, clothing, scene and layout. Proportional slimming
of cheeks/jaw/chin is allowed where the template calls for it; brighter, even
complexion keeps natural undertones and texture. Exact template contour locks
and isolated feature insertion were removed. Whole-face relighting corrects
source capture shadows, including the eye area. Template artwork and text
preservation remain. No route, model, quality, credit, Standard or Advanced change.

Validation PASS: typecheck, backend build, npm test (295 pass / 1 skip / 0 fail),
3 explicit Fast snapshot isolation/retry tests, git diff --check. No image-quality
claim: no new paid generation, photo mutation, commit, prepared image or deploy.
Production remains revision 4, fast-prompt-20261020T083233Z API/worker images.
Next deployment requires isolated live-source preparation and explicit owner
approval; compare new results against the actual source face and template.
Other dirty work preserved. Files changed this turn: Fast composer and this doc.

## Revision 5 deployed — 2026-10-20T09:09:27Z

Owner explicitly approved deployment. Active API:
`photobooth-express:fast-prompt-20261020T090849Z`; worker same tag with `-worker`.
Persistent manifest, compose and rollback to revision 4:
`/srv/photobooth/releases/fast-prompt-20261020T090849Z/`.

Verification PASS: isolated live-source compile and 3 snapshot tests per image;
compose config, refreshed snapshot validate, API healthy, worker running,
zero restarts, clean startup logs; local/public health and web port /create;
routing/reference validation (Fast Sunburst100 Low, Standard cx50 Low).
Compiled prompt marker SOURCE FACE PORTRAIT WITH TEMPLATE STYLING and in-memory
Fast/Standard/default snapshot checks passed in both containers without DB
writes/provider generation. New Fast Basic jobs use the complete source face
and template-guided retouching. Historical snapshots remain unchanged.
Web/helper/gateway untouched. No paid generation, photo modification or commit;
visual quality remains unverified. Unrelated working-tree changes retained.

## Revision 6 — face-only identity with model retouch, source only

Read-only review of revision-5 result job `370790fac66df734a088a90386e46b66`
confirms its latest frozen prompt. The output imported the short source haircut
instead of retaining the template styled hair; source cheek/jaw fullness remains.
Owner clarified: face only, template hair unchanged, source face actively adapted
to template proportions, visibly slimmer/more defined and lighter complexion to
match the template/model finish. Revision 5 is not visual acceptance.

Changed only Fast composer and this doc. New marker FACE-ONLY IDENTITY EDIT WITH
TEMPLATE MODEL RETOUCH. Explicitly restricts the requested edit to facial skin
below template hairline through cheeks/jaw/chin; excludes source hair/scalp/ears,
head silhouette, neck/body/background. Template hairstyle/hairline/forehead locks
are to remain. Makes slimming/sculpting and complexion matching explicit using
template facial ratios, cheek-to-jaw taper and face length; keeps source identity
with coherent facial relationships. Lighter skin follows template face/neck
brightness and undertone, with natural texture. Previous optional/gentle retouch
wording replaced. This is a prompt edit boundary, not a new pixel-mask mechanism;
image preservation is still a generative instruction requiring visual validation.

Validation PASS: typecheck, build, npm test (295 pass, 1 skip, 0 fail), explicit
Fast snapshot tests (3 pass), git diff --check. No paid generation, photo mutation,
commit, image preparation or deploy. Production remains revision 5
fast-prompt-20261020T090849Z API/worker. Model/quality remain Sunburst/low; routing,
credits, Standard and Advanced unchanged. Requires separately approved deploy.

## Revision 6 deployed — 2026-10-20T09:18:38Z

Owner explicitly approved deployment. API image:
`photobooth-express:fast-prompt-20261020T091756Z`; worker same tag with `-worker`.
Persistent manifest/compose/rollback to revision 5:
`/srv/photobooth/releases/fast-prompt-20261020T091756Z/`.

Verification PASS: isolated live-source compile and 3 snapshot tests per image;
compose config, regenerated snapshot validate, API healthy, worker running,
zero restarts, clean startup logs; local/public health and web port /create;
Fast Sunburst100 Low / Standard cx50 Low and gateway reference validation.
Both containers passed compiled FACE-ONLY IDENTITY EDIT WITH TEMPLATE MODEL
RETOUCH marker checks plus in-memory Fast/Standard/default job snapshots.
No paid generation or database writes in these runtime checks. Visual quality,
hair preservation and model retouch remain unverified pending a new result.
Web/helper/gateway/schema unchanged. Source remains uncommitted; unrelated
working-tree changes preserved. Only new Fast Basic jobs use this revision.

## Revision 7 — source anatomy, modest retouch, source only

Owner corrected the interpretation of revision 6: use source facial anatomy
and proportions, keep only the hairstyle from the template (along with its
existing body/scene styling), and apply modest AI beauty retouch: lighter skin,
slightly slimmer cheeks and a more defined face suited to commander/aviation.
The prior template facial ratio/model proportion target is explicitly superseded.
This correction does not establish visual acceptance of revision 6.

Changed Fast composer and this handoff only. New marker SOURCE FACE WITH LIGHT
BEAUTY RETOUCH AND TEMPLATE HAIR. Source governs whole-face anatomy, proportions
and distinctive feature relationships. Removed instructions to match template
face length, temple-to-cheek ratio, taper and template-model complexion. Slight
cheek slimming/jaw definition and lighter/brighter skin are requested directly,
with natural texture and source identity intact. Template governs hairstyle,
pose, clothing, theme, composition and lighting; it does not govern facial anatomy.
No provider/routing/quality/credits/Standard/Advanced changes.

Validation PASS: typecheck, build, npm test (295 pass / 1 skip / 0 fail), explicit
Fast snapshot tests (3 pass), git diff --check. No new visual test, paid generation,
photo modification, prepared image, deploy or commit. Production remains revision
6 fast-prompt-20261020T091756Z API/worker pending separate deploy approval.
Unrelated dirty working-tree files remain untouched.

## Revision 7 deployed — 2026-10-20T09:25:30Z

Owner explicitly approved deployment. API image:
`photobooth-express:fast-prompt-20261020T092448Z`; worker same tag with `-worker`.
Persistent release/manifest/compose and rollback to revision 6:
`/srv/photobooth/releases/fast-prompt-20261020T092448Z/`.

Verification PASS: isolated live-source compile and 3 snapshot tests per image,
compose config, regenerated snapshot validate, API healthy, worker running,
zero restarts, clean startup logs, local/public health and real web port /create,
Fast Sunburst100 Low / Standard cx50 Low and gateway reference validation.
Both active containers confirm compiled SOURCE FACE WITH LIGHT BEAUTY RETOUCH
AND TEMPLATE HAIR marker and pass in-memory Fast/Standard/default snapshot
creation checks. Source anatomy and proportions now govern the face; template
hair and light retouch instructions apply to new Fast Basic jobs only. No paid
generation, database writes during runtime tests, photo modification or commit.
Visual quality remains unverified. Web/helper/gateway/schema unchanged;
unrelated working-tree changes preserved.

## Revision 8 — stronger male face and visible-neck retouch, source only

Owner reports revision 7 is good and requests a more commanding masculine
appearance: stronger face retouch, lean under-chin/neck without fullness, and a
natural Adam's apple suited to commander/aviation. Retains the source identity
and template hair direction. No new visual quality claim by the agent.

Changed Fast composer and this handoff only. Marker now SOURCE FACE WITH PORTRAIT
RETOUCH AND TEMPLATE HAIR. Added a prompt instruction specifically for male
portrait templates: stronger cheek/jaw/chin definition than gentle default,
leaner exposed neck/under-chin, subtle natural neck tendons and proportionate
Adam's apple. Existing source face anatomy/identity and lighter complexion remain;
no return to matching the template model face. Clothing/collar/tie, head scale
and pose must remain: no exposing extra neck to show the requested anatomy.
Female/hijab templates are explicitly excluded from this masculine instruction
in the prompt. This is model-directed conditional behavior, not a separate
code-level template classifier or pixel mask. Visual validation remains needed.

Validation PASS: typecheck, build, npm test (295 pass / 1 skip / 0 fail), scoped
Fast snapshot tests (3 pass), git diff --check. No paid generation, photo mutation,
commit, image preparation or deploy. Production remains revision 7
fast-prompt-20261020T092448Z API/worker until separately approved deployment.
Sunburst/low, route/credits, Standard and Advanced unchanged. Other dirty files
preserved.

## Revision 8 deployed — 2026-10-20T09:32:25Z

Owner explicitly approved deployment. API:
`photobooth-express:fast-prompt-20261020T093145Z`; worker same tag with `-worker`.
Persistent release/manifest/compose/rollback to revision 7:
`/srv/photobooth/releases/fast-prompt-20261020T093145Z/`.

Verification PASS: isolated live-source compile and 3 snapshot tests per image,
compose config, regenerated snapshot validate, API healthy, worker running,
zero restarts, clean startup logs; local/public health and real web port /create;
Fast Sunburst100 Low / Standard cx50 Low and gateway reference validation.
Both active containers confirm compiled revision-8 marker and male face/neck
instruction, and pass in-memory Fast/Standard/default job snapshot checks.
No paid generation, runtime-test database writes, photo mutation or commit.
Visual quality and stronger neck/face rendering require a new result review.
Web/helper/gateway/schema unchanged; unrelated working-tree changes preserved.
Only newly created Fast Basic jobs use revision 8.

## Revision 8 visual rejection and prompt audit

Owner rejects latest job `b1cd0601d7df72b24f2a07b6720e99f2`. Read-only inspection
confirms its frozen snapshot contains revision 8 including the masculine neck
instruction. Compared actual result/source with revision-7 job
`0032636d1657f27ac79c5061e36a6374`, its source, the Aviation template and preferred
Codex output. Latest face appears wider/full-bodied within the styled head,
cheeks/jaw remain soft, under-chin definition is not convincingly improved.
Template hair is retained. Neck is substantially covered by shirt collar/tie;
a visible Adam's apple cannot be relied on while preserving this composition.
Sources are different captures, so differences cannot isolate prompt effects.

Prompt audit: preserving source anatomy/proportions including cheek/jaw/chin
competes with stronger sculpting; gentle/modest default and stronger male
retouch coexist as separate competing directives. The paragraph expressly
requests stronger masculine retouch but output does not establish compliance.
These are observable specification weaknesses, not proof of provider internals.
Owner asked for review: no prompt edit, code change, rollback or deploy performed.
No paid generation/photo mutation. Revision 8 remains live and is not visually
accepted. Passing technical deployment tests did not prove quality. Future
changes should consolidate the retouch instruction and compare identical
source/template inputs before another rollout.

## Revision 9 — source proportions with explicit contour retouch, source only

Owner clarified that source facial proportions are correct to preserve, while
cheek/jaw/chin must be retouched toward a more defined commander/aviation look
and lighter skin. This does not authorize copying template facial proportions.

Changed Fast composer and this doc only. New marker SOURCE PROPORTIONS WITH
THEMED CONTOUR RETOUCH AND TEMPLATE HAIR. Consolidated gentle/default and stronger
male directives into one themed retouch instruction. Source identity, eye shape
and spacing, nose/lips and relative feature positions remain the foundation;
explicitly allows reducing cheek fullness and reshaping jaw/chin contours while
preserving that foundation. Adds head-to-body scale preservation. Removes prior
instruction saying theme does not affect anatomy, which conflicted with requested
contour retouch. Lighter complexion is direct, not conditioned on template skin.
Lean exposed neck remains; Adam's apple only where existing collar/pose expose
it. Template hairstyle/clothing/scene remain. Female/hijab instruction excludes
masculine jaw/neck styling. No route/model/quality/credit/Standard/Advanced change.

Validation PASS: typecheck, build, npm test (295 pass / 1 skip / 0 fail), explicit
Fast snapshot tests (3 pass), git diff --check. No paid generation, new visual
acceptance, photo mutation, commit, prepared image or deploy. Production remains
revision 8 fast-prompt-20261020T093145Z API/worker until separately approved deploy.
Unrelated dirty work retained.

## Revision 9 deployed — 2026-10-20T09:52:27Z

Owner explicitly approved deployment. API:
`photobooth-express:fast-prompt-20261020T095138Z`; worker same tag with `-worker`.
Persistent release/manifest/compose and rollback to revision 8:
`/srv/photobooth/releases/fast-prompt-20261020T095138Z/`.

Verification PASS: isolated live-source compile and 3 snapshot tests per image,
compose config, regenerated snapshot validate, API healthy, worker running,
zero restarts, clean startup logs; local/public health and real web port /create;
Fast Sunburst100 Low / Standard cx50 Low and gateway reference validation.
Both active containers confirm the compiled revision-9 marker and pass in-memory
Fast/Standard/default job snapshot checks. No paid generation or runtime-test
DB writes, photo mutation or commit. Only new Fast Basic jobs use this prompt;
visual quality remains unverified. Web/helper/gateway/schema unchanged;
unrelated working-tree changes preserved.

## Revision 10 — remake the source person, source only

Owner rejects revision 9 and explicitly requests REMAKE of the source face.
Replaced transfer/retouch instructions with full regeneration: Image 2 supplies
recognizable identity; the entire face is newly rendered as an idealized themed
portrait. Removed source proportion/feature-position locks and instructions to
preserve captured face geometry. Source anatomy can be rebuilt into leaner,
sculpted, commanding male features and lighter skin while preserving identity.
Template hairstyle, head scale/pose, uniform, scene and frame remain. Female/
hijab portraits exclude male anatomy; exposed-neck definition does not permit
altering the collar. New marker REMAKE THE SOURCE PERSON AS A THEMED PORTRAIT.
Prompt is shorter and replaces earlier competing directives rather than adding
a new override. Changes only Fast composer and this handoff.

Validation PASS: typecheck, build, npm test (295 pass / 1 skip / 0 fail), scoped
Fast snapshot tests (3 pass), git diff --check. No paid generation, photo mutation,
commit, prepared image or deploy. Production remains revision 9
fast-prompt-20261020T095138Z API/worker until explicit deployment approval.
Actual remake appearance and identity retention are unverified. Model/quality
remain Sunburst/low; route/credits, Standard and Advanced unchanged. Unrelated
dirty working-tree files preserved.

## Revision 10 deployed — 2026-10-20T10:10:30Z

Owner explicitly approved deployment. API:
`photobooth-express:fast-prompt-20261020T100936Z`; worker same tag with `-worker`.
Persistent release/manifest/compose/rollback to revision 9:
`/srv/photobooth/releases/fast-prompt-20261020T100936Z/`.

Verification PASS: isolated live-source compile and 3 snapshot tests per image,
compose config, regenerated snapshot validate, API healthy, worker running,
zero restarts, clean startup logs; local/public health and real web port /create;
Fast Sunburst100 Low / Standard cx50 Low and gateway reference validation.
Both active containers confirm compiled REMAKE THE SOURCE PERSON AS A THEMED
PORTRAIT marker and pass in-memory Fast/Standard/default job snapshot checks.
Only new Fast Basic jobs use the remake prompt. No paid generation, runtime-test
DB writes, photo mutation or commit. Visual quality/identity retention remain
unverified. Web/helper/gateway/schema unchanged; unrelated dirty files preserved.

## Revision 10 latest visual review — partial, not accepted

Owner requests assessment of latest result and says it does not achieve the
commander/aviation look. Read-only review of job
`3496d8343c4118ff712f44d507974384` confirms the REMAKE frozen prompt, Aviation
Captain Man template and Sunburst output. Compared the actual source and frozen
template with the result. Template hair/uniform/frame/scene remain; result skin
is visibly brighter and face narrower than the source capture. However jaw/
cheek definition and firm expression remain softer than the desired template
portrait, with flatter facial lighting and less sculpted chin-to-neck separation.
The commander/aviation setting is present; requested commanding face rendering
is only partial. Neck is mostly hidden by collar; Adam's apple is not a useful
acceptance criterion in this composition. Source is a different capture from
previous tests, so no controlled prompt-quality comparison is established.

The job did use revision 10; this is not evidence of a stale deployment. Prompt
contains remake/lean face/angular jaw/confident eyes directives, but this output
does not fully realize them. No code/prompt change, deploy, rollback, paid
generation or customer-photo mutation during review. Revision 10 remains live;
no full visual acceptance claimed. Review-only documentation is uncommitted.

## Revision 11 — remake structure, character and lighting, source only

Owner requested a fix after the partial visual result reviewed above. Updated
Fast composer and this handoff only. Marker REMAKE THE SOURCE PERSON WITH
DEFINED STRUCTURE AND PORTRAIT LIGHTING. Replaced the generic regenerated-face
paragraph with concrete cheekbone/lower-cheek planes, ear-to-chin jaw definition,
firm chin and chin-to-neck separation for male commander/aviation portraits.
Source eyes/brows/nose/lips serve as identity cues; exact source measurements or
template-model facial anatomy remain unlocked. Direct, alert gaze and a composed
mouth express authority without a scowl or glamour pout. Head scale remains
proportional; hollow cheeks or oversized muscles are excluded.

Added one coherent lighting direction tied to the actual template face: key
light direction, color balance, highlight placement and portrait contrast shape
cheek/nose/jaw planes. Fill light keeps eye detail, so deepened eye sockets are
not used to simulate strength. Uniform skin brightening must not flatten the
face; lighter complexion retains texture and undertones. Template hair, uniform,
scene and frame remain. Adam's apple is optional only where collar exposes it.
Female/hijab templates explicitly exclude masculine jaw/neck styling.

Validation PASS: typecheck, build, npm test (295 pass / 1 skip / 0 fail), explicit
Fast snapshot tests (3 pass), git diff --check. No paid generation, photo mutation,
commit, image preparation or deploy. Production remains revision 10
fast-prompt-20261020T100936Z API/worker pending separate explicit approval.
This revision has no image-quality validation. Model/quality remain Sunburst/low;
route/credits, Standard/Advanced and unrelated dirty files unchanged.

## Revision 11 deployed — 2026-10-20T13:38:21Z

Owner explicitly approved deployment. API:
`photobooth-express:fast-prompt-20261020T133735Z`; worker same tag with `-worker`.
Persistent release/manifest/compose/rollback to revision 10:
`/srv/photobooth/releases/fast-prompt-20261020T133735Z/`.

Verification PASS: isolated live-source compile and 3 snapshot tests per image,
compose config, regenerated snapshot validate, API healthy, worker running,
zero restarts, clean startup logs; local/public health and real web port /create;
Fast Sunburst100 Low / Standard cx50 Low and gateway reference validation.
Both active containers confirm the compiled revision-11 remake/structure/lighting
marker and pass in-memory Fast/Standard/default job snapshot checks. Only new
Fast Basic jobs use this prompt. No paid generation or runtime-test DB writes,
photo mutation or commit. Visual quality remains unverified. Web/helper/gateway/
schema unchanged; unrelated working-tree changes preserved.

## Revision 12 deployed — 2026-10-20T13:44Z (template-dominant)

Owner clarified the goal: the template's handsome, defined face is the base and the
customer only adds resemblance (eyes, brows, nose, lips). Revisions 5-11 were
source-dominant and are superseded; the Fast composer is now a short
template-dominant prompt (marker `TEMPLATE PORTRAIT WITH THE CUSTOMER'S RESEMBLANCE`).
Review of today's 20 jobs: the old template-dominant prompt (jobs before 15:02 and
Standard job 17:21) gave the most natural results; source-dominant "remake" prompts
lost identity or kept the source's soft jaw. Revision 11 job `ae8e14ce…` kept identity
but did not gain jaw definition or open eyes.

Release `fast-prompt-20261020T134332Z` (API + worker, rollback to revision 11
`fast-prompt-20261020T133735Z`). Owner approved. Checks: typecheck, 3 Fast snapshot
tests, snapshot validate PASS, healthy/0 restarts, marker present in both containers,
web /create 200. No paid generation; visual result untested. Source uncommitted.

## Revision 13 deployed — likeness rebuild (2026-10-20)

Owner reviewed revision-12 job `03f54aa5…`: slimmer and template-like, but the face
looked cut and pasted. Revision 12 treated Image 2 as a list of features to take; the
composer now asks for a newly painted face as a likeness of the customer, rendered in
the template's skin texture, light and finish (marker `TEMPLATE PORTRAIT WITH A
LIKENESS OF THE CUSTOMER`). Release `fast-prompt-20261020T135046Z`, rollback to
revision 12 `fast-prompt-20261020T134332Z`. Owner approved. Typecheck, 3 snapshot tests,
snapshot validate, health, marker in both containers, web /create checked. No paid
generation; visual result untested. Source uncommitted.

## Revision 14 deployed — hair lock and sharper jaw (2026-10-20)

Revision-13 job `d8c7ec7f…` had a natural, recognizable repainted face but took the
customer's short curly hair; revision 13 had dropped "hair" from the do-not-take list.
Composer now limits the repaint to forehead-below-hairline through chin, locks the
template hair and bans the customer's hair/haircut/scalp, and asks for a clearly
defined angular jaw and firm chin matching template sharpness. Release
`fast-prompt-20261020T135428Z`, rollback to revision 13 `fast-prompt-20261020T135046Z`.
Owner approved. Typecheck, 3 snapshot tests, snapshot validate, health, marker in both
containers, web /create checked. No paid generation; result untested. Source uncommitted.

## Revisions 15-16 deployed — jaw wording reverted, nose/lip size (2026-10-20)

Revision-14 job `507f6164…` looked tired and too thin; its only face-affecting change
over revision 13 was the "angular jaw / firm chin" sentence, so revision 15
(`fast-prompt-20261020T140532Z`) kept the hair lock and restored "defined jaw and chin".
Owner then saw larger lips and nose than the template (confirmed in a close-up crop):
the likeness block named nose and lips as features to capture and the source is a
wide-angle close-up. Revision 16 asks for nose/lip character only, a slim nose and
understated lips at Image 1's scale, and says Image 2's wide-angle close-up inflates
them. That close-up assumption is hard-coded for every photo.
Release `fast-prompt-20261020T140838Z`, rollback to revision 15. Owner approved.
Typecheck, 3 snapshot tests, snapshot validate, health/0 restarts, marker in both
containers and web /create 200 checked. No paid generation; revisions 15 and 16 not
yet visually reviewed. Source uncommitted.

## 2026-10-22 — Basic head rebuild, footer text by the image model, Advanced footer, processing meter (Claude)

Live (owner approved each deploy): API/worker/helper `fast-prompt-20261022T035356Z`, web `processing-meter-20261022T040303Z`.
Deploy with `scripts/deploy_footer_style.py prepare|deploy|rollback` (API, worker, helper; wraps
`deploy_fast_prompt.py`, which patches the live container source) and `scripts/deploy_processing_meter.py`
(web; builds from the frontend copy of the live web release plus only its listed files).

- Basic prompt (`fast-basic-prompt.service.ts`, every lane): the whole head is rebuilt as the customer.
  Image 1 gives concepts only (hairstyle, skin brightness, slim look, light, clothing, scene); the customer's
  hair is restyled to the template style even when short or bald; skin is lightened and the face slimmed only
  when needed; the head stays the size of the template head. Per-theme `TEMPLATE LIGHT` notes keep the light
  consistent so the head does not look pasted.
- Prompt-only approaches kept drifting to the template actor's face. The fix is structural:
  `basic_edit.prepare_template` blurs the detected template face before the provider call (`blur_face`).
  Template files on disk are unchanged.
- Event name and date are lettered by the image model: Basic `PLATE TEXT` (name left, date right on the
  empty v2 plate), Advanced `FOOTER EVENT LINE` (below the NXBooth branding). The QR is always drawn by code
  (`result_footer.py`, `qr_only` metadata): Basic in the empty bottom-right square, Advanced in the print band
  below the square artwork. Jobs frozen without these blocks keep the old code-drawn text.
- Web: the processing screen shows an estimated progress ring (`processingProgress.js`, capped at 95% until the
  job is really COMPLETED) and rotating phrases instead of the source photo; the event name field is the first
  item of the review panel for Basic and Advanced.
- Lessons: judge prompt changes on several generations with the same source photo; single samples misled
  several revisions. Words that reference "the person in Image 1" (jaw width, skin of that person, brows)
  pull the result toward the template actor.
