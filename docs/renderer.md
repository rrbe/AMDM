# Renderer Development Constraints

## State management

`useAppStore.ts` is the single source of truth for Renderer state and backend actions. Asynchronous actions should write errors into displayable state instead of throwing them into the React render path.

Global notifications use the bounded `notifications` queue in the store. Producers must report a non-cancelled, user-relevant asynchronous failure exactly once, with a stable `source` and `dedupeKey` when it can repeat. Keep contextual details in their owning result, form, or progress UI as well; the toast is the attention layer, not the only error record. Do not notify for expected cancellation, inline validation, owner cleanup, or best-effort background decoration such as autocomplete sampling. Classify timeout/network/auth failures in main and carry the stable failure kind over IPC instead of parsing localized or driver-generated messages in Renderer.

Result date display uses the app's time zone preference (which may follow the system). `ResultTimeZoneContext` scopes it to all result views
and preview portals. The result toolbar's Display options popover and Settings share
the same persisted time zone preference. Pure formatters receive the resolved zone explicitly; source
EJSON stays unchanged. Copy/export/edit operations use UTC source values. JSON and
structured Console selections carry UTC copy text on BSON Date tokens; complete
tokens copy that value, while partial selections and plain output retain the selected
characters. Never infer BSON types by matching rendered text.

`TimeZoneSelect` is controlled by `value` / `onChange` and shared by Settings and
the result toolbar. Its pure catalog/search logic lives in `lib/timeZoneOptions.ts`.
City metadata comes from `@vvo/tzdb`; `lib/timeZoneCities.json` supplies common
Chinese city names and additional city aliases. ICU supplies localized time zone
names and date-specific offsets; labels include the daylight/summer name when
applicable. City/name search ignores separators and accents. The catalog uses runtime-supported region IDs
and UTC. Signed offset searches match that sign; an unsigned hour matches either sign. The result
toolbar loads the selector and its city data on demand. Search results scroll
inside a fixed-size popup so filtering does not move the input.

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

## Shell editor

Keep CodeMirror's JavaScript parser for syntax and local scopes. Shell semantic colors layer over it; completion uses Mongosh's official declarations from `@mongosh/shell-api/api`, augmented with live collection names and AMDM's `driverDb`. `scripts/mongosh-editor-types.mjs` resolves declarations at build time, so no Shell runtime enters the Renderer. Restart the development server after editing this generator.

The TypeScript service and declaration graph load in a worker when the editor receives focus. Only small API-member metadata is loaded with the editor. Inline value hints remain local and must not appear inside comments or string literals.

Query diagnostics share this worker and run after a 350 ms input pause. They report JavaScript syntax errors, unresolved names/members, and calls to non-functions using the official Mongosh declarations. Collection warnings use only the selected connection/database's loaded catalog; an unloaded catalog is not an empty database. These warnings do not prevent writes to new collections. Analysis never executes a query or fetches metadata. Top-level `show`/`use` commands retain their source offsets, and switching database inside a script suspends catalog checks until it returns to the selected database. Editor changes, catalog updates, and tab/connection/database switches invalidate pending replies. Hover shows details; F8 moves to the next problem and Cmd/Ctrl+Shift+M opens the problems panel.

## UI validation

Debug and validate against the currently running Electron Renderer. Use Electron DevTools/CDP to inspect DOM, computed styles, events, focus, scrolling, and state. If attachment is unavailable, enable a remote debugging port for Electron or use its built-in DevTools; do not launch a regular Chrome instance as a substitute.

Use screenshots only for final visual judgments such as color, spacing, radius, and shadow. They do not replace interaction and computed-style validation.
