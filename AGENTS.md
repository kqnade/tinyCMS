# Repository instructions

## Scope and authority

- Treat `.dev/` as repository-owned workflow state. Read only the active task and directly linked context needed for the current work.
- Use `.dev/designdoc/tinycms.md` as the current architecture snapshot, but reconcile it with the current user request, Git state, runtime evidence, and primary sources.
- Implement only explicitly authorized increments. The design snapshot does not authorize the complete product by itself.
- Keep changes small, cohesive, and limited to the current requirement. Preserve unrelated and user-authored changes.

## Toolchain

- Run `mise install` after cloning or when `.mise.toml` changes.
- Use the Node.js, pnpm, and Wrangler versions managed by mise. Do not introduce npm or Yarn lockfiles.
- Use pnpm for JavaScript workspace dependencies when the workspace is added.
- Keep generated output, local Wrangler state, dotenv files, and credentials out of Git.

## Cloudflare safety

- Never place secrets or production resource identifiers in tracked configuration.
- Use isolated development resources for bindings marked `remote: true`. Never point normal local development at production data.
- Treat deployment, provisioning, schema migration against remote data, and other external mutations as separately authorized actions.

## Verification and commits

- Run the narrowest relevant checks after each change and report anything that could not be verified.
- Keep documentation and commands consistent with the current repository state; do not describe unavailable application commands as runnable.
- Separate commits by concern and stage only the paths belonging to that increment.
- Use `git cc` for local commits after inspecting status, the staged diff, and verification results.
- Do not push or otherwise mutate remotes without explicit authorization.
