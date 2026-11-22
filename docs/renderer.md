# Renderer Development Constraints

## State management

`useAppStore.ts` is the single source of truth for Renderer state and backend actions. Asynchronous actions should write errors into displayable state instead of throwing them into the React render path.

Global notifications use the bounded `notifications` queue in the store. Producers must report a non-cancelled, user-relevant asynchronous failure exactly once, with a stable `source` and `dedupeKey` when it can repeat. Keep contextual details in their owning result, form, or progress UI as well; the toast is the attention layer, not the only error record. Do not notify for expected cancellation, inline validation, owner cleanup, or best-effort background decoration such as autocomplete sampling. Classify timeout/network/auth failures in main and carry the stable failure kind over IPC instead of parsing localized or driver-generated messages in Renderer.

Display dates using the application's time zone in every result view and preview. Copy, export, and edit use the UTC source value. In JSON and structured Console output, copying a complete BSON Date token yields its UTC value. Partial selections and plain output preserve the selected characters. Determine BSON types from source EJSON.

Zustand selectors must return stable references:

- Update `Set`, arrays, and nested records immutably.
- Preserve references for unchanged branches to avoid unrelated component renders.
- Do not create non-memoized object or array literals inside selectors.

## Shell editor

Keep CodeMirror's JavaScript parser for syntax and local scopes. Shell semantic colors layer over it; completion uses Mongosh's official declarations from `@mongosh/shell-api/api`, augmented with live collection names and AMDM's `driverDb`. `scripts/mongosh-editor-types.mjs` resolves declarations at build time, so no Shell runtime enters the Renderer. Restart the development server after editing this generator.

Keep editor analysis off the interactive path. Diagnostics use the loaded catalog for the selected connection and database. An unloaded catalog cannot establish that a collection is missing. Warnings allow writes to new collections. Analysis must never execute code or fetch metadata. Discard stale diagnostics after edits, catalog updates, or context switches.

## UI validation

Debug and validate against the currently running Electron Renderer. Use Electron DevTools/CDP to inspect DOM, computed styles, events, focus, scrolling, and state. If attachment is unavailable, enable a remote debugging port for Electron or use its built-in DevTools; do not launch a regular Chrome instance as a substitute.

Use screenshots only for final visual judgments such as color, spacing, radius, and shadow. They do not replace interaction and computed-style validation.
