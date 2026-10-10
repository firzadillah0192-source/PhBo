# Retro frontend deployment

Status: **PASS**. Published at https://nxbooth.gennexbyte.com/ on 2026-10-06.

## Release

- Image: `photobooth-web:retro-20261006T055419Z`.
- Release snapshot and manifest: `/srv/photobooth/releases/retro-20261006T055419Z`.
- Previous image retained as `photobooth-web:before-retro-20261006T055419Z`.
- Source starts from the snapshot matching the previously deployed frontend, with only the retro UI files overlaid. Unreleased admin, pricing, photo-management and API changes in the workspace were excluded.
- Existing nginx configuration, Express API proxy and compiled Google client configuration were preserved. The image retains old hashed assets for already-open clients.

## Files and commands

UI changes are in `frontend/src/retro.css`, `frontend/src/studioHistory.js`, `frontend/src/App.jsx`, `frontend/src/main.jsx`, the landing/chooser components, customer navigation, progress, photo, review, processing and result components, `frontend/index.html`, and the local font/favicon assets.

Release orchestration: `scripts/deploy_retro_frontend.py`.
Production acceptance check: `frontend/scripts/retro-deployed-check.mjs`.

```sh
python3 scripts/deploy_retro_frontend.py prepare
python3 scripts/deploy_retro_frontend.py build
python3 scripts/deploy_retro_frontend.py deploy
node frontend/scripts/retro-deployed-check.mjs
```

The script validates `docker compose config --quiet` with the active override chain before startup and deploys only `photobooth-web` using `up -d --no-deps --no-build`. Required existing engine credentials are reused in subprocess memory without printing or persisting their values.

## Validation

- Workspace frontend: 72 tests passed, production build passed, and four browser cases passed with fixture APIs, including upload, generation states, file download, provider failure, saved-photo recovery and delayed-upload isolation.
- Frozen release: frontend tests and build passed; logs are saved in the release directory.
- Production: served JavaScript, CSS, fonts and favicon match the release by SHA-256.
- Production browser checks passed at 1440, 390, 320 and 820 px widths: actual published catalogs, chooser, Basic photo entry, browser Back/Forward, refresh recovery, in-app back controls, Advanced frame options, Escape dismissal, horizontal overflow and browser runtime errors.
- Container status: `photobooth-web` running and healthy. Startup/log checks passed.
- Real `/api/health`: `status: ok`; database, Redis, storage and queue each report `ok`.
- Production checks were read-only and did not submit a photo or run paid generation. Generation behavior was exercised using fixture APIs before release.
- Live screenshots and report: `test/output/retro-deployed/`, especially `checks.json`.

## VPS isolation and rollback

All non-web container IDs were unchanged after deployment. The existing `photobooth-net`, port 3000 mapping and volumes were preserved. PostgreSQL and Redis remain internal. Host reverse proxy, firewall and other projects were untouched.

Before deployment, the host had approximately 119 GB free disk and 7.0 GiB available memory; no resource expansion was required.

To restore the retained frontend image:

```sh
python3 scripts/deploy_retro_frontend.py rollback
```

The release path pointer is `/tmp/photobooth-retro-release-path`. Rollback uses the saved active Compose chain and `compose.rollback.yml` in the release directory.
