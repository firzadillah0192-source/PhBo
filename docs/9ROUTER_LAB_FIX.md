# 9Router Lab registration fix

The admin form uses the server-configured 9Router gateway automatically. Save a 9Router access key, then Test connection, Register models, and enable the provider for Lab. OpenAI API keys and OAuth accounts are managed in 9Router.

Model registration reads `/v1/models/image`, preserves the gateway's exact IDs including `nb/nanobanana-pro`, and reports missing credentials, HTTP failures, and malformed catalogs. Prices remain unknown until verified. Listed models do not establish generation support; OAuth/API-key routing separation is not part of this fix.

The live Lab baseline contains earlier uncommitted work. To avoid committing that work, the exact three-file task delta is versioned in `scripts/patches/9router_lab.patch`. The matching changes are present in the working source files; existing baseline changes remain uncommitted. Once the baseline is committed, the patch can be applied on top of it with `patch --batch --forward --fuzz=0 -p1 -i scripts/patches/9router_lab.patch` (do not apply it twice).

`scripts/deploy_9router_lab.py prepare` checks that applying the committed patch to live source produces exactly the three working source files, then builds a release from live API and frontend snapshots. This prevents unrelated edits from entering the deployment. Release Compose files, source snapshots, manifest and rollback definitions are stored under `/srv/photobooth/releases/`. `deploy` and `rollback` require owner approval and regenerate/validate the Express snapshot afterward.

The Express snapshot generator lists only the running container's environment keys, with dotenv values represented by placeholders. It avoids a broad `env_file` that would inject new keys into older containers. This fixes validation of the worker lacking the Lab encryption variable without changing the worker container.

Validation before release: backend 214 passed, 1 MinIO integration skipped; frontend 111 passed; TypeScript typecheck and both builds passed. The live gateway returned 14 image model IDs. Paid generation was not run.
