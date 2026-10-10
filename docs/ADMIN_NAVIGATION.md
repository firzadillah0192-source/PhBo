# Admin navigation and cache

The admin is already a React SPA. A white-screen failure on leaving
Subscriptions, Advanced Experiences, or Admin Users was reproduced in Chrome:
the `useEffect(load, ...)` callback returned the data-loading Promise, which
React attempted to call during cleanup. AdminPage and the Basic/Classic panels
now invoke loaders inside callbacks that return no Promise.

Admin GET responses are cached in per-tab memory for 30 seconds and concurrent
identical requests are deduplicated. Filter URLs have separate entries. Failed
requests are not cached. Login/logout and all admin mutations clear the cache;
pending responses cannot repopulate it after invalidation. Authentication
verification through `/admin/overview` and customer generation polling always
use live requests. Browser/edge cache remains disabled for dynamic API data.

Refresh data clears the cache and remounts the current section, resetting its
local filters/forms. Reloading the document clears the in-memory cache.

Validation: `npm test`, `npm run build`, and
`node frontend/scripts/admin-navigation-check.mjs` from the project root.
The browser check requires Node 22, Chrome CDP on localhost:9223, the app on
localhost:3000, and the configured admin token in `/opt/photobooth/.env`.
It creates an isolated browser context, checks 14 menu transitions, verifies
cached reads/refresh/logout and JavaScript errors, then disposes the context.
It does not print credentials or change admin business data.
