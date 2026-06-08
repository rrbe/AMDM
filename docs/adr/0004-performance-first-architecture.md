# Performance-first rendering architecture (the anti-NoSQLBooster rules)

**Status:** accepted

Performance is the project's #1 priority, and the reason NoSQLBooster was abandoned. The rules below target what we believe are the root causes of its lag, inferred from observed behavior (not from vendor-published measurements). They are non-negotiable; every feature must respect them or it doesn't ship.

## The rules

1. **Virtualize every large list/tree/table.** The DOM holds only visible rows + a small buffer, regardless of result count. Un-virtualized DOM reflow appears to be NoSQLBooster's biggest flaw — even a handful of large docs could lag. The expandable Tree view especially must be virtualized; render nested children only on expand.
2. **Stream cursors, bound pages at the data layer.** Pull from the driver cursor in batches; never materialize a whole collection in the renderer. Hard default page size (e.g. 50–100), cheap to raise because rendering is virtualized.
3. **Heavy CPU off the main thread.** BSON↔EJSON conversion, pretty-printing, large-doc formatting, and schema sampling run in a Worker (or main/utility process), streamed to the UI. NoSQLBooster's multi-second freezes looked like classic main-thread blocking.
4. **Schema sampling is lazy, bounded, async, cached.** Never analyze full nested schemas synchronously on collection-open (a likely cause of NoSQLBooster's OOM crashes). Sample a small bounded set (e.g. 20–100 docs) in a Worker, cap depth/field count, cache, and let the user trigger deeper analysis explicitly.
5. **No auto-query on collection open.** Show metadata first; fetch the first page only on explicit action or with a tiny default limit.
6. **Dispose aggressively.** On tab/connection close, dispose editor models and free result buffers to prevent the long-session memory growth NoSQLBooster suffered. Clean up all child/helper processes on quit (long sessions otherwise risk zombie-process CPU growth).
7. **Keep the runtime current and the bundle lean.** Ship a current Electron with **native** builds for each target architecture (arm64 for Apple Silicon, x64 for Intel) so nothing runs under Rosetta emulation. "No Rosetta" means *don't emulate* — it does **not** mean arm64-only; shipping a native x64 build for Intel is fully consistent with this rule. Lazy-load heavy features; tree-shake.

## Consequences

These rules are what make [0001-build-on-electron.md](./0001-build-on-electron.md) defensible — Electron is only fast if we hold this line. Editor choice (CodeMirror 6, lazy-loaded) follows rule 7.
