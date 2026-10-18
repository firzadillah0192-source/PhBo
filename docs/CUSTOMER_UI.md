# Customer UI: layout and language

Scope: the web customer app (`.customer-app.retro-app`). The kiosk (`/kiosk`) has no `.retro-app` class and keeps its own styles.

## Layout

- `frontend/src/customerLayout.css` is the only layout layer for customer pages. It replaces `customerViewport.css` (no longer imported from `main.jsx`; the file is unused and can be deleted).
- Pages scroll naturally. Nothing is forced to `100svh`, and type never goes below 12px.
- One container: `--nx-max` (1600px) with `--nx-gutter`. The header, the studio shell and the chooser all use it, so their edges line up.
- Create flow (`App.jsx`): `.studio-shell` = left rail (`StudioRail.jsx`: progress, selection summary, credit) + `.studio-content`. Each stage uses the side space for a panel: photo tips, review/cost/generate, advanced summary, result QR and actions. Below 900px the rail collapses to a progress strip and panels stack.
- Account center: sticky profile + section nav on the left, content on the right. Plans use a container query (5 across, 3+2 centered, then 1 column). Payment history is a table (`PaymentHistory.jsx`) that stacks on phones.
- Decoration in the gutters is limited to marketing pages (`.is-marketing`).

## Language

- `frontend/src/i18n.js`: Indonesian (`id`) is the default; `en` is the alternative. The choice is stored per device in `localStorage` (`nxbooth.lang`), not on the account.
- Components: `const t = useT()` then `t('Teks Indonesia', 'English text')`. Outside components use `tr(id, en)`. Library helpers (`cameraFailureMessage`, `generationFailureMessage`, `generationFailureActionLabel`) take a `language` argument that defaults to `'en'`, so existing tests are unchanged; callers pass `getLanguage()`.
- Where to switch: ID/EN toggle in the header (`LanguageToggle`) and the "Bahasa tampilan" field in Profile and Personalization (`LanguageSelect`).
- Server messages (for example `privacy.retention_message`, `billing.message`, API `message`) are shown as the server sends them.
- Not translated yet: admin, kiosk screens, `PhotoFolders`, `DeveloperApi`, `KioskClaimPage`, `GoogleSignInButton`.

## Checks

- `npm test` (frontend): includes `i18n.test.js` and Indonesian-default assertions in `landing.test.js`, `threeModes.test.js`, `photoManagement.test.js`.
- `scripts/customer-viewport-check.mjs`: renders the flow at nine sizes (320 to 1918px) and fails on horizontal overflow, type under 12px, or an unreachable primary action. Run it against a build outside the repo, for example:
  `NXBOOTH_PLAYWRIGHT_MODULE=<path to playwright> NXBOOTH_DIST=<vite build dir> NXBOOTH_OUTPUT=<dir> node scripts/customer-viewport-check.mjs`
