# tinyCMS

tinyCMS is an edge-native, single-site publishing system for Cloudflare. It aims to combine a low-friction authoring experience with a quiet, readable public blog.

The repository currently provides the editorial core:

- separate Hono Workers for public and administrative traffic;
- a focused React, Vite, and Tiptap writing Studio;
- Access-protected post, draft, checkpoint, and revision APIs;
- D1-backed optimistic draft saves and immutable revision history;
- Studio assets deployed with the Admin Worker;
- shared content validation, rendering, and HTTP contracts;
- end-to-end tests running against Cloudflare's local `workerd` and D1 runtime;
- strict TypeScript, Biome, pinned mise tools, Renovate, and least-privilege CI.

The authoring path is usable after deployment behind Cloudflare Access. Publication, media, public reading, search, likes, and AI assistance remain to be implemented. The planned scope and security model are recorded in the [design snapshot](.dev/designdoc/tinycms.md).

## Applications

| Application | Local URL | Current behavior |
| --- | --- | --- |
| Public Worker | `http://127.0.0.1:8787` | Hono health endpoint and public-only routing boundary |
| Admin Worker | `http://127.0.0.1:8788` | Access-protected editorial API and built Studio assets |
| Studio | `http://127.0.0.1:5173` | Focused editor development server; authenticated API requests are not proxied |

## Development

[mise](https://mise.jdx.dev/) installs the repository versions of Node.js, pnpm, and Wrangler.

```sh
mise trust
mise install
mise run install
pnpm build
cd apps/admin-worker
mise exec -- wrangler d1 migrations apply CMS_DB --local
cd ../..
mise run dev
```

The development servers bind only to `127.0.0.1`. Check the Worker boundaries with:

```sh
curl http://127.0.0.1:8787/healthz
curl -i -H 'Host: localhost' http://127.0.0.1:8788/healthz
```

The public request returns the health response. The Admin Worker fails closed with the tracked local defaults, so the admin request returns `401` with `AUTH_REQUIRED` until it receives a valid `Cf-Access-Jwt-Assertion` header and valid Access configuration.

The standalone Vite server is useful for Studio UI development. A production build serves the Studio from the Admin Worker through Workers Static Assets:

```sh
pnpm build
pnpm --dir apps/admin-worker dev
```

The local Admin Worker deliberately has no authentication bypass. Its API integration tests use signed Access fixtures; use an isolated Cloudflare staging deployment behind Access for an interactive end-to-end authoring session.

Run the complete local quality gate with:

```sh
mise run check
```

This checks formatting, lint, generated Worker types, TypeScript, unit and `workerd` tests, the Studio production bundle, and Wrangler dry-run bundles. No command in the default check or build flow deploys a Worker.

## Configuration

The tracked `wrangler.jsonc` files contain development-safe defaults and no Cloudflare resource identifiers. Wrangler generates `worker-configuration.d.ts`; rerun the following command from an affected Worker directory after changing its bindings:

```sh
mise exec -- wrangler types --include-runtime false
```

The Admin Worker requires these non-secret variables:

- `ADMIN_HOST`: the exact canonical administration hostname;
- `ACCESS_TEAM_DOMAIN`: the bare Cloudflare Access hostname, such as `team.cloudflareaccess.com`, without a scheme, path, or port;
- `ACCESS_AUD`: the exact application audience tag, which must be present in the verified token's `aud` claim.

Both values are empty in the tracked local configuration. An assertion presented while either value is empty is rejected with `AUTH_INVALID`.

Dotenv files and `.dev.vars` files are ignored. Commit an example file only when the application consumes the corresponding value, and include placeholders rather than credentials. Production identifiers, account-specific routes, and secrets must not be added to the public template.

Cloudflare deployment, remote migrations, resource provisioning, and secret changes are intentionally outside the local development flow. They require an explicit environment-specific action.

## Repository layout

```text
apps/
  admin-worker/
  public-worker/
  studio/
packages/
  application/
  content/
  contracts/
  database/
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development rules and [SECURITY.md](SECURITY.md) for the current security boundary.

## License

tinyCMS is available under the [MIT License](LICENSE).
