Created 0 of 1 detected sources in PostHog. The PostgreSQL credential prompt was cancelled, so the source needs browser setup.

# PostHog data warehouse setup report

## Changes made

- No PostgreSQL source was created in PostHog.
- No application source code or environment configuration was changed.
- This report was created to document the browser handoff.

## Files created

- `posthog-warehouse-report.md`

## Manual steps

1. Open [PostgreSQL source setup](https://us.i.posthog.com/project/654547/data-warehouse/new-source?kind=Postgres&utm_source=wizard&utm_campaign=warehouse-source).
2. Enter a TLS-enabled PostgreSQL connection that is publicly reachable over IPv4, or configure an SSH tunnel.
3. If required, allowlist PostHog’s US egress IPs: `44.205.89.55`, `52.4.194.122`, and `44.208.188.173`.
4. Select the schemas and tables to sync, then finish linking the source.
