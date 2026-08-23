# Renderer Development Constraints

## State management

`useAppStore.ts` is the single source of truth for Renderer state and backend actions. Asynchronous actions should write errors into displayable state instead of throwing them into the React render path.

Global notifications use the bounded `notifications` queue in the store. Producers must report a non-cancelled, user-relevant asynchronous failure exactly once, with a stable `source` and `dedupeKey` when it can repeat. Keep contextual details in their owning result, form, or progress UI as well; the toast is the attention layer, not the only error record. Do not notify for expected cancellation, inline validation, owner cleanup, or best-effort background decoration such as autocomplete sampling. Classify timeout/network/auth failures in main and carry the stable failure kind over IPC instead of parsing localized or driver-generated messages in Renderer.

Zustand selectors must return stable references:

- Update `Set`, arrays, and nested records immutably.
- Preserve references for unchanged branches to avoid unrelated component renders.
- Do not create non-memoized object or array literals inside selectors.

## Styling boundaries

Treat [../DESIGN.md](../DESIGN.md) as the source of truth for visual rules. The Renderer is currently migrating from global CSS to Tailwind v4:

- Prefer Tailwind utilities, `cva`, and `lib/utils.ts#cn` for new components. Business components must access Base UI through `components/ui/*`.
- Tailwind preflight is intentionally disabled during the migration. Place bare-element defaults in `@layer base`; otherwise unlayered CSS overrides utilities.
- The import order in `styles/index.css` is a cascade contract. Do not reorder it during unrelated work.
- Keep design tokens, third-party selectors, and shared data styles global. Self-contained complex components may use CSS Modules.
- Use semantic tokens for new colors and provide mappings for both light and dark themes.

Do not repeat detailed class names or file inventories here when `DESIGN.md`, component facades, or the existing directory structure already make a convention easy to discover.

## UI validation

Debug and validate against the currently running Electron Renderer. Use Electron DevTools/CDP to inspect DOM, computed styles, events, focus, scrolling, and state. If attachment is unavailable, enable a remote debugging port for Electron or use its built-in DevTools; do not launch a regular Chrome instance as a substitute.

Use screenshots only for final visual judgments such as color, spacing, radius, and shadow. They do not replace interaction and computed-style validation.
