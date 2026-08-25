# Objective

Make the admin Worker enforce the Cloudflare Access boundary itself so protected routes never rely only on an upstream dashboard configuration.

# Scope

- Own only `apps/admin-worker/**` in this increment.
- Keep the existing exact-host fence and run it before any authentication network work so an unexpected host returns `404` without leaking admin behavior.
- Require `Cf-Access-Jwt-Assertion` on every admin route, including `/healthz`.
- Configure verification through non-secret Worker variables `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`; do not commit tenant values.
- Verify the JWT signature from the Access JWKS endpoint and validate issuer, audience, expiry, and not-before claims. Do not trust identity headers without a verified token.
- Return the existing JSON error envelope with `AUTH_REQUIRED` for a missing assertion and `AUTH_INVALID` for any invalid assertion, without exposing token or cryptographic details.
- Cache JWKS data only for a bounded duration and fail closed when retrieval or verification fails.
- Add deterministic tests using local keys and an injected fetch boundary; tests must not call Cloudflare.
- Do not add dependencies or modify the workspace lockfile in this increment.

# Non-goals

- Cloudflare Zero Trust dashboard or Terraform configuration.
- Role-based authorization beyond a valid Access application audience.
- Editorial CRUD endpoints, D1 access, or Studio session UX.
- A development bypass for authentication.

# Durable records

- [tinyCMS design snapshot](../designdoc/tinycms.md)

# Commit checklist

- [ ] Add failing tests for missing, malformed, wrongly issued, wrongly targeted, expired, not-yet-valid, and correctly signed tokens.
- [ ] Implement host-first Access JWT verification with bounded JWKS caching and fail-closed errors.
- [ ] Document only the required variable names in the app's local configuration template or README surface.
- [ ] Verify app tests, type checks, formatting, and the repository-wide quality gate.
- [ ] Remove this completed TODO through the repository helper, inspect the staged changes, and commit the Green increment with `git cc`.
