# Performance-first rendering architecture (the anti-NoSQLBooster rules)

**Status:** accepted

Performance is the project's #1 priority, and the reason NoSQLBooster was abandoned. Research (June 2026) identified its concrete root causes from primary sources (incl. vendor admissions). These rules are non-negotiable; every feature must respect them or it doesn't ship.

## The rules

1. **Virtualize every large list/tree/table.** The DOM holds only visible rows + a small buffer, regardless of result count. NoSQLBooster's vendor-admitted #1 flaw was un-virtualized DOM reflow — even 7–10 large docs lagged. The expandable Tree view especially must be virtualized; render nested children only on expand.
2. **Stream cursors, bound pages at the data layer.** Pull from the driver cursor in batches; never materialize a whole collection in the renderer. Hard default page size (e.g. 50–100), cheap to raise because rendering is virtualized.
3. **Heavy CPU off the main thread.** BSON↔EJSON conversion, pretty-printing, large-doc formatting, and schema sampling run in a Worker (or main/utility process), streamed to the UI. NoSQLBooster's 20–30s freezes were classic main-thread blocking.
4. **Schema sampling is lazy, bounded, async, cached.** Never analyze full nested schemas synchronously on collection-open (that caused NoSQLBooster's OOM crashes). Sample a small bounded set (e.g. 20–100 docs) in a Worker, cap depth/field count, cache, and let the user trigger deeper analysis explicitly.
5. **No auto-query on collection open.** Show metadata first; fetch the first page only on explicit action or with a tiny default limit (NoSQLBooster's "hold SHIFT to bypass" was an admission of this mistake).
6. **Dispose aggressively.** On tab/connection close, dispose editor models and free result buffers to prevent the long-session memory growth NoSQLBooster suffered. Clean up all child/helper processes on quit (they had zombie-process CPU bugs).
7. **Keep the runtime current and the bundle lean.** Ship a current Electron with native arm64 builds (no Rosetta — that alone cut NoSQLBooster's ~850MB baseline). Lazy-load heavy features; tree-shake.

## Consequences

These rules are what make [0001-build-on-electron.md](./0001-build-on-electron.md) defensible — Electron is only fast if we hold this line. Editor choice (CodeMirror 6, lazy-loaded) follows rule 7.
