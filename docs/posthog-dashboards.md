# Shared PostHog dashboard specification

Status: PASS for dashboard creation and saved-query execution on 2026-10-09; PARTIAL for real business-event coverage. MCP OAuth is connected. Both application ingestion tokens were matched to project 654547 without displaying their values. SDK deployment evidence remains in [deployment verification](posthog-deployment.md).

- [Gennexbyte — Traffic and Contact](https://us.posthog.com/project/654547/dashboard/2189875): five insight tiles.
- [PhBo — Web and Kiosk](https://us.posthog.com/project/654547/dashboard/2189878): seven insight tiles.

All 12 native queries ran successfully before saving. Both saved dashboards were then run with `dashboard-insights-run` and `refresh: force_blocking`; every tile returned successfully without query warnings. Persisted app/test filters and non-overlapping layouts were read back and checked. [Saved definitions and IDs](posthog-dashboard-definitions.json) contain no credentials or customer records.

Indexed records currently include Gennexbyte browser activity, marked Gennexbyte backend contact/error diagnostics and marked PhBo SDK diagnostics. No PhBo operational events, non-test persisted contact submission or non-test exception were observed at setup. PhBo charts therefore remain empty pending usage; this does not establish an end-to-end production generation conversion. Unmarked browser verification traffic may remain in the Gennexbyte charts, so the small current visitor/funnel counts must not be treated as customer results. No production form submission, paid generation or hardware operation was triggered during dashboard setup.

The governed catalog is empty. Insight descriptions mark these definitions as provisional; none is presented as approved. The existing contact daily trend `0CxbXsWB` was reused with explicit app/test filters and retains membership in the original wizard dashboard. Other legacy starter/wizard tiles remain unchanged and may show different counts because their original filters differ.

Use one project and two dashboards. Apply the event property `app` to every insight, including funnels and error queries. Exclude events where `is_test` equals boolean `true`; retain events where the property is absent. Default range: last 30 days, daily interval. Never add frontend and backend versions of the same action together.

## Gennexbyte analytics

Filter: `app = gennexbyte`.

| Tile | Events and calculation | Meaning |
| --- | --- | --- |
| Daily visitors | `$pageview`, unique persons per day | Observed browser identities, not guaranteed unique people |
| Daily contact submissions | `contact_form_submitted`, total count per day | Backend event after contact persistence |
| Contact conversion funnel | `contact_form_submit_started` → `contact_form_submitted`, ordered unique-person funnel, 1-hour window | Requires correlated browser/backend identity; repeated submissions are not counted as separate people |
| Contact form failures | `contact_form_submit_failed`, total count | Frontend observed submission failures |
| Application exceptions | `$exception`, breakdown by `surface` | Sanitized frontend/backend exceptions |

`contact_form_success_shown` describes the browser displaying success; it is not a second persisted submission. Do not count both as conversions.

## PhBo analytics

Filter: `app = phbo`.

| Tile | Events and calculation | Meaning |
| --- | --- | --- |
| Daily visitors | `$pageview`, unique persons per day | Browser activity across web and kiosk routes |
| Web generation funnel | `phbo_upload_succeeded` → `phbo_generation_accepted` → `phbo_generation_completed`, filter `surface = web`, ordered unique-person funnel, 1-hour window | User progression; not exact per-job conversion |
| Accepted jobs | `phbo_generation_queued`, unique `job_id` per day | Server acceptance; do not add browser acceptance counts |
| Observed completed/failed jobs | `phbo_generation_status_completed` and `phbo_generation_status_failed`, unique `job_id` per event per day | Terminal states observed by API polling, not direct worker completion telemetry |
| Kiosk captures and retakes | `phbo_photo_captured` and `phbo_photo_retake`, total count, filter `surface = kiosk` | Captures include repeated attempts; neither count represents finished sessions |
| Kiosk download clicks | `phbo_result_download_clicked`, total count, filter `surface = kiosk` | Clicks, not confirmed downloads or physical prints |
| Application exceptions | `$exception`, breakdown by `surface` | API/frontend exceptions; independent worker failures are not instrumented |

The web/kiosk `surface` contract was checked against the deployed source; operational PhBo values are not yet present in indexed records. Unique-job tiles use native TrendsQuery custom aggregation `uniqExact(properties.job_id)`, which ran successfully; counts are not replaced with event totals. Multi-series and exception charts show legends. Do not infer throughput, exact success percentage, event revenue, printing speed or session completion from these existing events.

## Creation and verification after MCP login

1. Confirm the selected project matches both applications' configured ingestion project, without exposing credentials.
2. Search existing dashboards and insights, including the wizard's contact dashboard; reuse valid tiles rather than creating duplicates.
3. Inspect indexed event names, `app`, `surface`, `is_test`, correlation IDs and real timestamps. Diagnose missing ingestion instead of inventing example results.
4. Consult the Data Catalog for approved matching metrics. If none exist, mark these definitions as provisional rather than claiming governed metrics.
5. Run each query before saving it. Prefer native trends/funnels; use SQL only where a required calculation is unsupported.
6. Verify all saved dashboard tiles, app separation and exclusion of marked diagnostic events. Report empty real data as empty, not as a failed application build.

Session replay, surveys, source-map upload and PostgreSQL warehouse integration are separate tasks. PostgreSQL remains internal. OpenAI/Codex model-training controls are account settings and are unrelated to these dashboards.
