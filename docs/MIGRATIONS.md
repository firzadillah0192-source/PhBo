# Database migrations

The project has no Alembic configuration, migration runner, or schema-version
table. SQL migration files are **not** automatically executed by filename.
Apply them manually, forward-only, in the sequence below.

At API startup, `app.db.init_db()` imports the SQLAlchemy models and calls
`Base.metadata.create_all()`, then runs a small set of hard-coded additive
compatibility alterations. This creates missing current-model tables, but does
not alter existing tables to match changed models and does not execute the SQL
files. Some SQL files also perform data updates, so startup is not a substitute
for applying the migration sequence.

| Order | File | Purpose |
| --- | --- | --- |
| 001 | `001_admin_registry.sql` | Admin registry and `experience_id` compatibility column |
| 002 | `002_usage_auth.sql` | Accounts, guest/auth sessions and quota ownership columns |
| 003 | `003_control_plane.sql` | Admin actors, identities, credit ledger, subscriptions, events and audit |
| 004 | `004_experience_publication.sql` | Experience publication/category fields |
| 005 | `005_preview_factory.sql` | Advanced preview status, sources and jobs |
| 006 | `006_basic_marketing_preview.sql` | Basic marketing-preview path |
| 007 | `007_publish_initial_experience.sql` | Conditional `mini-me` starter publication |
| 008 | `008_provider_usage_operations.sql` | Provider execution telemetry |
| 009 | `009_result_claims.sql` | Secure expiring QR-result claims |

The duplicate `008` was the QR migration filename. It has been safely
renumbered to `009_result_claims.sql`; `008_provider_usage_operations.sql` is
unchanged. Do not rename or rewrite a migration already applied in production.

For a production cutover, back up PostgreSQL first, then apply only files
verified as unapplied, preserving the documented order. Example for an
operator who has confirmed that 001–008 are already applied and only 009
remains:

```bash
docker compose exec -T photobooth-postgres \
  sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < backend/migrations/009_result_claims.sql
```

Do not infer migration history from table presence alone: startup
`create_all()` may have created tables without recording migration versions.
Confirm production history with the operator before applying anything.
