# Persist app state in JSON config files, not SQLite

**Status:** accepted

All of this app's own persistent state — saved connections (`connections.json`), saved queries + capped history (`queries.json`), and UI preferences (`settings.json`) — is stored as plain JSON files in the Electron `userData` directory. We deliberately do **not** embed SQLite.

The data is tiny (tens–low-hundreds of records), single-user, single-process, written infrequently (only on user edits), and read whole by key. None of SQLite's strengths (indexed queries, transactions, concurrency, large datasets) apply. Meanwhile SQLite would add a native module (`better-sqlite3`) requiring an Electron-ABI rebuild — exactly the native-build friction we avoid under pnpm v10 + Electron (and against the lean ethos of [0001](./0001-build-on-electron.md)/[0004](./0004-performance-first-architecture.md)).

## Considered options

- **SQLite (better-sqlite3 / sql.js)** — rejected: native-module/WASM complexity and a real dependency for zero benefit at this scale.

## Consequences

Secrets still go through `safeStorage` (Keychain), not the JSON files in plaintext. Revisit SQLite only if a real need appears: caching large query results, full-text search over history, very large numbers of saved items, or analytical queries over local data.
