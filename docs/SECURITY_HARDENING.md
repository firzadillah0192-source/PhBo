# Security hardening before scanning

This change protects the existing Photobooth API without changing its deployment
or adding services. It is not a SAST/DAST report or a guarantee of no vulnerabilities.

## Implemented controls

- Every API mutation checks browser Origin, falling back to Referer and Fetch
  Metadata. Only the request origin and explicit `CORS_ORIGINS` are trusted.
  `Origin: null`, untrusted origins, and untrusted same-site/cross-site requests
  are blocked with `403 CSRF_BLOCKED`. CLI clients without browser provenance
  headers remain supported; these headers are not authentication credentials.
- Uploads, generation jobs and results require matching account or guest
  ownership. Legacy rows with no owner return 404, including attempts to generate
  from an unowned upload. There is no automatic assignment of legacy photos.
- Admin access checks the current actor registry on every request. Demotion,
  deactivation and deletion affect existing sessions immediately. The legacy
  admin header respects the same role and active-state checks.
- Customer uploads read at most `UPLOAD_MAX_BYTES + 1` bytes into application
  memory and return 413 when over the limit. Decoded image format, MIME and
  filename extension must agree; path-like filenames are rejected. Dimensions
  and supported formats are checked before decoding pixels. Pillow decompression
  bomb errors become validation failures rather than server errors.
- Request validation responses omit supplied passwords/tokens/body values.
  Unexpected API/worker failures and upstream AI response bodies are not sent
  to customers. Missing photo responses do not reveal storage paths.
- API responses, including private images, use `Cache-Control: no-store`,
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and
  `Referrer-Policy: no-referrer`. API responses also use a restrictive CSP.
- A new Google identity cannot link to a password account solely by matching
  its unverified email. Linking requires an authenticated session for that same
  account. Existing Google identities can still sign in normally.
- Production rejects missing/example session secrets, weak/example admin
  tokens and wildcard CORS. Cookies remain HttpOnly/SameSite=Lax and become
  Secure in production. Public Swagger, ReDoc and OpenAPI routes are disabled
  in production. Malformed cookie signatures are rejected safely.

## Deployment requirements and limitations

Set `ENVIRONMENT=production`, a unique random `SESSION_SECRET_KEY` of at least
32 characters and an equally strong `ADMIN_TOKEN` (or leave admin disabled).
Set `CORS_ORIGINS` to the exact trusted frontend origins. Deliver the app over
HTTPS. Incorrect production settings intentionally prevent startup.

The changes require a rebuild/deployment before a DAST scan of the live app can
observe them. No running containers, runtime photos, databases, shared reverse
proxy, firewall or other applications were changed by this patch.

API headers do not configure the frontend HTML or the public TLS proxy.
Frontend CSP/HSTS, infrastructure settings, dependency/container vulnerability
checks, login/upload throttling and authenticated DAST coverage still require
separate verification. The existing nginx body limit applies at the web entry
point; the bounded upload read does not impose a total streaming multipart body
limit when clients bypass nginx and reach FastAPI directly.

Accounts created with passwords do not have email verification/recovery flows.
An existing password account must be authenticated before first Google linking;
existing identity links are not migrated by this patch. Guest quota is still
cookie-based and is not protection against a client creating new guest sessions.

## Validation

Run `.venv/bin/python -m pytest backend/tests -q` from the repository root.
`backend/tests/test_security_hardening.py` includes cross-site mutations,
unauthorized/legacy private resources, revoked admin privileges, spoofed uploads,
oversized images, secret-bearing failures, Google linking and production settings.

Against the pre-change commit `9e098a7`, the initial 64 new cases produced 56
failures and 8 passes. A further case checks whitespace around example secrets.
With this patch, all 155 backend tests passed. Provider pipeline tests
use an explicit test double and do not represent a real AI generation.

A temporary Uvicorn process with SQLite under `/tmp` also verified startup,
`GET /api/health`, cross-site POST rejection, real JPEG upload, guest session
cookies and byte-for-byte private preview over HTTP. Redis was intentionally
unavailable and no AI provider was connected for this isolated check.
