# Architecture and Cross-Layer Contracts

This document records constraints that span multiple directories and are difficult to verify from a single file. Source code and tests remain authoritative for specific APIs and compatibility lists.

## Process boundaries

- `src/main/` owns MongoDB connections, SSH, file-system access, secure storage, Shell execution, and workers.
- `src/preload/` exposes only the typed `window.api`; the Renderer must not access Node or `ipcRenderer` directly.
- `src/shared/` defines cross-process channels and wire types. Renderer-side asynchronous operations are centralized in the store.

The typical call chain is: store action → `window.api` → preload → IPC handler → main service. When changing IPC, check the shared contract, preload, handler, caller, and relevant tests together; never update only one end of the chain.

## Application updates

- macOS uses the native Sparkle bridge with architecture-specific English/Chinese appcasts selected by the application language and EdDSA-signed delta archives. Each release keeps deltas from the three most recent compatible versions and always retains the full ZIP fallback.
- Windows NSIS and Linux AppImage builds use `electron-updater` with GitHub release metadata. Downloads start only after an explicit user action; the main process owns progress, cancellation, and installation state.
- Update state crosses into the Renderer only through the shared IPC contract. Windows/Linux automatically check at most every six hours when enabled; macOS scheduling remains owned by Sparkle.
- Windows requires `latest.yml` plus the installer blockmap. Linux requires `latest-linux.yml`; its blockmap is embedded in the AppImage. These files are part of the release contract, not optional build output.

## Testability

Keep transformation, validation, and planning logic in cores that do not depend on Electron or live connections. Session, IPC, file-system, and system APIs should remain thin adapters. Add unit tests for new core logic and integration tests for cross-layer write paths or handlers.

## Shell compatibility layer

All query execution goes through `src/main/mongo/shellEngine.ts` to `mongoshCore.ts`, which adapts the official evaluator, Shell API, and Node Driver provider to `ShellResult`. The runtime loads on first execution. Tabs, history, saved queries, and settings do not select an engine; persisted runtime fields from older versions are ignored.

Each execution owns its provider listeners, cursors, and sessions; cleanup ends sessions left open by the isolated script without suspending the shared `MongoClient`. Renderer completion handlers must still match the tab's current `execId`, so a closed or superseded tab cannot receive late results, notifications, or database-switch state.

Scripts that need Node Driver method signatures use `driverDb`. It resolves to the selected database on the existing connection and follows `use <database>` changes. Use explicit `await` for intermediate Driver promises. Bare Driver cursors are bounded and closed; find cursors support paging. Explicit `toArray()` remains a full operation.

`shellSupport.ts` contains output collection, explicit top-level-await preparation, Driver access, cancellation of serialization waits, and best-effort collection detection. It does not modify Driver prototypes.

- Preserve official positional arguments, completion values, and implicit-await behavior.
- Errors created inside `vm` come from another realm. Extract details structurally.
- Bound results by default. Materialize a complete cursor only when explicitly requested.
- Never retry a failed script automatically: it may already have written data.

## Serialization and output

- Encode BSON results from main as EJSON-canonical values. `serialize-core.ts` produces the wire format, while `renderer/src/lib/ejson.ts` interprets it. Adding a BSON type requires coordinated changes to both sides and `test/fixtures/bson-corpus.ts`.
- Workers and inline fallbacks must reuse the same pure core so formats cannot diverge between runtimes. Confirm buffer ownership before transferring binary buffers; buffers backed by Node's shared allocation pool must not be added directly to a transfer list.
- Console output still uses a one-shot result protocol, so its line limit must remain. Remove that limit only after implementing end-to-end chunked transport, Renderer virtualization, complete-result caching, and Copy All support.

## State and resource ownership

- Store connection passwords and SSH passphrases with Electron secure storage. The Renderer should receive only non-sensitive state such as whether a secret exists.
- The component that creates a resource owns its cleanup. Connection, tab, task, and application shutdown paths must release their cursors, MongoClient instances, SSH tunnels, workers, subscriptions, and caches.
- Cancellation must do more than stop waiting. Terminate or isolate underlying work and late callbacks so they cannot mutate state after cancellation.
