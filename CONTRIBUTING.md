# Contributing

tinyCMS is under active development. Keep changes focused on an agreed behavior and avoid adding Cloudflare products, abstractions, or compatibility layers before they are needed.

## Setup

```sh
mise trust
mise install
mise run install
mise run check
```

Use the Node.js, pnpm, and Wrangler versions managed by mise. Do not create npm or Yarn lockfiles.

## Changes

- Add or update a behavior test before changing executable behavior.
- Keep public and administrative routes in their respective Workers.
- Preserve strict TypeScript and the shared response contracts.
- Run the narrowest relevant test while working, then run `mise run check` before submitting a change.
- Keep commits cohesive and do not combine application, infrastructure, CI, and documentation changes without a concrete reason.
- Update documentation when a command, security boundary, or configuration contract changes.

Wrangler generates each Worker's `worker-configuration.d.ts`. After changing a Worker binding, run this command from that Worker directory and commit the generated result:

```sh
mise exec -- wrangler types --include-runtime false
```

## Cloudflare safety

- Never commit credentials, production resource identifiers, Access tokens, or private content.
- Use isolated development resources for any binding that must connect remotely.
- Do not point ordinary local development at production data.
- Treat deployments, remote migrations, provisioning, and secret changes as separate operations requiring explicit authorization.

Report suspected vulnerabilities according to [SECURITY.md](SECURITY.md).
