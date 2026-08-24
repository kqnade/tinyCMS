# tinyCMS

tinyCMS is an edge-native, single-site publishing system for Cloudflare. It aims to combine a low-friction authoring experience with a quiet, readable public blog.

The repository currently provides a runnable development foundation:

- separate Hono Workers for public and administrative traffic;
- a React and Vite Studio shell;
- shared HTTP response contracts;
- tests running in Cloudflare's local `workerd` runtime;
- strict TypeScript, Biome, pinned mise tools, Renovate, and least-privilege CI.

It is not yet a usable CMS. Storage bindings, editorial workflows, Access JWT verification, publishing, search, likes, and AI assistance remain to be implemented. The planned scope and security model are recorded in the [design snapshot](.dev/designdoc/tinycms.md).

## Applications

| Application | Local URL | Current behavior |
| --- | --- | --- |
| Public Worker | `http://127.0.0.1:8787` | Hono health endpoint and public-only routing boundary |
| Admin Worker | `http://127.0.0.1:8788` | Hono health endpoint restricted to the configured host |
| Studio | `http://127.0.0.1:5173` | React application shell with light and dark themes |

## Development

[mise](https://mise.jdx.dev/) installs the repository versions of Node.js, pnpm, and Wrangler.

```sh
mise trust
mise install
mise run install
mise run dev
```

The development servers bind only to `127.0.0.1`. Verify the Worker endpoints with:

```sh
curl http://127.0.0.1:8787/healthz
curl -H 'Host: localhost' http://127.0.0.1:8788/healthz
```

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

Dotenv files and `.dev.vars` files are ignored. Commit an example file only when the application consumes the corresponding value, and include placeholders rather than credentials. Production identifiers, account-specific routes, and secrets must not be added to the public template.

Cloudflare deployment, remote migrations, resource provisioning, and secret changes are intentionally outside the local development flow. They require an explicit environment-specific action.

## Repository layout

```text
apps/
  admin-worker/
  public-worker/
  studio/
packages/
  contracts/
```

Additional package boundaries will be introduced with the behavior that needs them. See [CONTRIBUTING.md](CONTRIBUTING.md) for development rules and [SECURITY.md](SECURITY.md) for the current security boundary.

## License

A license has not yet been selected. Do not assume permission beyond the rights granted by applicable law until a license file is added.
