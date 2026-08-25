# Security policy

## Supported versions

tinyCMS has not published a stable release. Security fixes are made only on the current default branch.

## Reporting a vulnerability

Use GitHub private vulnerability reporting for this repository when it is available. If it is unavailable, open a non-sensitive issue asking the maintainer for a private contact channel. Do not include exploit details, credentials, private content, or personal data in a public issue.

Include the affected component, impact, reproduction conditions, and any suggested mitigation in the private report. Allow the maintainer time to investigate before public disclosure.

## Current deployment boundary

The repository is a development foundation, not a production-ready CMS. The Admin Worker checks the exact request host before authentication network work, requires `Cf-Access-Jwt-Assertion`, and verifies the RS256 signature, issuer, application audience, expiry, and not-before claims against the Cloudflare Access JWKS. Authorization beyond membership in the configured Access application audience is not implemented. Do not expose it as a production authoring API.

`ACCESS_TEAM_DOMAIN` must be a bare Cloudflare Access subdomain ending in `.cloudflareaccess.com`, without a scheme, path, or port. `ACCESS_AUD` must be the exact application audience tag contained in the verified token's `aud` claim. Missing or invalid configuration fails closed.

The tracked Wrangler configuration contains local defaults only. Production deployment requires separate Access policies, restricted routes, secrets, response security headers, abuse controls, and environment-specific bindings described in the [design snapshot](.dev/designdoc/tinycms.md).
