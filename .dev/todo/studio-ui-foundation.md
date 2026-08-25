# Objective

Turn the Studio shell into an accessible, shadcn-inspired visual foundation that is ready for editor screens without pretending that persistence already exists.

# Scope

- Own only `apps/studio/**` in this increment.
- Define neutral light and dark design tokens for surfaces, text, borders, focus rings, radius, spacing, and typography.
- Add small reusable UI primitives needed by the current shell, including button, input, card, badge, and labeled field patterns, without adding Radix or shadcn dependencies yet.
- Rework the existing shell to use those primitives while keeping the current honest status: no working save, publish, AI, search, or upload action.
- Preserve semantic HTML, visible keyboard focus, reduced-motion behavior, responsive layout, and readable Japanese copy.
- Add component and shell tests for semantics and interactive state that do not require a live Worker.
- Do not add dependencies or modify the workspace lockfile in this increment.

# Non-goals

- A Tiptap editor, router, data fetching, authentication, persistence, or functional publish controls.
- Copying shadcn/ui source wholesale or introducing a component generator.
- Public blog styling or shared design-package extraction.

# Durable records

- [tinyCMS design snapshot](../designdoc/tinycms.md)

# Commit checklist

- [ ] Add failing tests for the primitive semantics and revised Studio shell.
- [ ] Implement tokens, UI primitives, and the responsive shell.
- [ ] Verify accessibility-sensitive states, app tests, type checks, formatting, and the repository-wide quality gate.
- [ ] Remove this completed TODO through the repository helper, inspect the staged changes, and commit the Green increment with `git cc`.
