# Objective

Give the public Worker a reusable HTTP boundary with consistent request IDs, safe error responses, and browser security headers before article routes are added.

# Scope

- Own only `apps/public-worker/**` in this increment.
- Preserve the existing success envelope `{ data, meta: { requestId } }` and error envelope `{ error: { code, message, requestId } }`.
- Ensure every response carries the same `X-Request-Id` value represented in its JSON envelope when an envelope is present.
- Add browser security headers suitable for a future same-origin HTML blog: content type protection, conservative referrer and permissions policies, frame-ancestor protection, and a same-origin default CSP that does not preclude later route-specific expansion.
- Mark health and error responses `Cache-Control: no-store`; do not impose a global cache policy on future article responses.
- Convert unhandled application errors to a generic `INTERNAL_ERROR` response and keep internal details out of the response while preserving testable logging behavior.
- Add tests for headers, request ID correlation, method/route misses, and thrown errors.
- Do not add dependencies or modify the workspace lockfile in this increment.

# Non-goals

- Article rendering, Markdown negotiation, caching of published content, sitemap, feeds, likes, or redirects.
- Cloudflare WAF, rate limiting, or Terraform configuration.
- Changes to shared packages or the admin Worker.

# Durable records

- [tinyCMS design snapshot](../designdoc/tinycms.md)

# Commit checklist

- [ ] Add failing tests for the public HTTP boundary behavior.
- [ ] Implement request correlation, security headers, cache directives, and generic error handling.
- [ ] Verify app tests, type checks, formatting, and the repository-wide quality gate.
- [ ] Remove this completed TODO through the repository helper, inspect the staged changes, and commit the Green increment with `git cc`.
