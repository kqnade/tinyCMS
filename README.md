# tinyCMS

tinyCMS is a single-site publishing system designed for Cloudflare Workers and a quiet, readable blog experience. It is intended to combine a low-friction writing interface with D1, R2, KV, Durable Objects, Vectorize, and Workers AI.

> [!IMPORTANT]
> The repository currently contains the architecture and development foundation only. No runnable Worker application has been implemented yet. See the [design snapshot](.dev/designdoc/tinycms.md) for the planned scope and unresolved decisions.

## Development environment

[mise](https://mise.jdx.dev/) installs the project versions of Node.js, pnpm, and Wrangler.

```sh
mise trust
mise install
mise exec -- node --version
mise exec -- pnpm --version
mise exec -- wrangler --version
```

Tool versions and checksums are recorded in [`.mise.toml`](.mise.toml) and [`mise.lock`](mise.lock). Application commands will be added with the Worker scaffold.

## Local configuration

Local Cloudflare state, dependencies, build output, and dotenv files are excluded from Git. Commit only example files such as `.env.example` or `.dev.vars.example`; never commit credentials or production resource identifiers.

Development will follow three verification levels:

1. Wrangler with local simulated bindings.
2. Local Worker code with isolated development AI and Vectorize remote bindings.
3. A Cloudflare staging environment for Access, routes, and network behavior.

Production resources must not be used as local remote bindings.

## Dependency updates

Renovate checks for normal updates daily after a one-day release age. Vulnerability fixes bypass the schedule and release-age delay. GitHub-native squash automerge remains subject to repository review and required-check rules.

## Repository guidance

Contributor and automation instructions are in [`AGENTS.md`](AGENTS.md).
