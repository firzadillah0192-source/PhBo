# Admin Control Plane Foundation

This development sprint adds an operational Admin console without changing the
customer generation contract.

## Authentication

Guests keep the signed `photobooth_guest` cookie. Password auth remains for
compatibility, while Google sign-in is available at `POST /api/account/google`
with `{ "id_token": "<Google ID token>" }`. The backend verifies signature,
issuer, audience, expiry, `sub`, and verified email through `google-auth`, then
creates its own signed HttpOnly Photobooth session. The Google token is never
used as the Photobooth session and is not stored.

The stable external identity key is `(provider, provider_subject)` in
`auth_identities`; email is profile metadata and account-linking metadata only.

## Google Cloud setup

1. Create or select a Google Cloud project.
2. Configure the OAuth consent screen and add the required test/production users.
3. Create a Web application OAuth client in Google Identity Services.
4. Set its client ID in the backend environment as `GOOGLE_CLIENT_ID`.
5. Configure the frontend GIS client with the same client ID when the customer
   sign-in button is wired by the customer UI stream.
6. Keep redirect/origin configuration limited to the real application origins.

No Google client secret is required for the browser ID-token verification flow.

## Admin roles

The bootstrap `ADMIN_TOKEN` creates/uses the `token-admin` actor as
`superadmin`. Admin sessions carry a role. `superadmin` can do everything;
`operator` can operate users, credits, subscriptions, jobs and audit; and
`content_manager` can manage experiences/templates. The Admin API enforces
these roles server-side. Browser state changes also perform a same-origin
CSRF check.

## Credit accounting

`credit_ledger` is append-only at the API layer. Account balance mutations and
ledger rows happen in the same database transaction. Generation reservation,
spend and refund entries use a generation idempotency key. Admin grant/deduct
requires a reason, confirmation, actor, and idempotency key. Existing account
balances receive one migration baseline entry.

## Advanced Preview Factory

Admin Advanced marketing previews are internal catalog assets, not customer
generation jobs, so they do not reserve or spend customer credits. The default
flow is prompt-only: no customer photo or other reference image is sent to the
AI provider. The worker requests wholly original artwork and explicitly
excludes copyrighted characters, franchise worlds, logos, protected symbols,
real-person likenesses, and named living-artist styles. This reduces copyright
and identity risk, but generated artwork still requires normal operator review
before publication; no automated prompt can provide an absolute legal
guarantee.

## Migration sequence

Apply migrations forward-only in this order:

```text
001_admin_registry.sql
002_usage_auth.sql
003_control_plane.sql
```

The third migration preserves existing accounts, jobs, registry rows, uploads,
and runtime assets. It creates identities, ledger, subscription, event, audit,
and admin actor tables and adds account/session operational columns.

## Current deliberate deferrals

- No payment provider or webhook integration.
- No individual admin credential/invitation flow; the configured token remains
  the bootstrap authentication mechanism.
- No customer-facing Google button in this Admin-focused sprint; the backend
  endpoint and frontend API helper are ready for the customer UI stream.
- No automatic recurring subscription billing/grant scheduler.
