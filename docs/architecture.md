# Architecture and Cross-Layer Contracts

This document records constraints that span multiple directories and are difficult to verify from a single file. Source code and tests remain authoritative for specific APIs and compatibility lists.

## Process boundaries

- `src/main/` owns MongoDB connections, SSH, file-system access, secure storage, Shell execution, and workers.
- `src/preload/` exposes only the typed `window.api`; the Renderer must not access Node or `ipcRenderer` directly.
- `src/shared/` defines cross-process channels and wire types. Renderer-side asynchronous operations are centralized in the store.

The typical call chain is: store action → `window.api` → preload → IPC handler → main service. When changing IPC, check the shared contract, preload, handler, caller, and relevant tests together; never update only one end of the chain.

## Testability

Keep transformation, validation, and planning logic in cores that do not depend on Electron or live connections. Session, IPC, file-system, and system APIs should remain thin adapters. Add unit tests for new core logic and integration tests for cross-layer write paths or handlers.

## Shell compatibility layer

`src/main/mongo/shellCore.ts` is authoritative for Shell behavior and the shim catalog. Preserve these contracts when maintaining it:

- Implement only the explicitly supported mongosh subset. Unknown helpers must fail clearly instead of being interpreted as collections or silently using incorrect semantics.
- Do not replace mongosh positional arguments, completion values, or implicit-await behavior with superficially similar Node driver APIs.
- Preserve synthetic promise tagging across proxies and cursor patches; otherwise multi-statement scripts can observe unresolved promises.
- Errors created inside `vm` come from another realm. Extract error details structurally instead of relying on `instanceof Error`.
- Bound results by default. Materialize a complete cursor only when the user explicitly invokes a full-result API.

## Serialization and output

- Encode BSON results from main as EJSON-canonical values. `serialize-core.ts` produces the wire format, while `renderer/src/lib/ejson.ts` interprets it. Adding a BSON type requires coordinated changes to both sides and `test/fixtures/bson-corpus.ts`.
- Workers and inline fallbacks must reuse the same pure core so formats cannot diverge between runtimes. Confirm buffer ownership before transferring binary buffers; buffers backed by Node's shared allocation pool must not be added directly to a transfer list.
- Console output still uses a one-shot result protocol, so its line limit must remain. Remove that limit only after implementing end-to-end chunked transport, Renderer virtualization, complete-result caching, and Copy All support.

## State and resource ownership

- Store connection passwords and SSH passphrases with Electron secure storage. The Renderer should receive only non-sensitive state such as whether a secret exists.
- The component that creates a resource owns its cleanup. Connection, tab, task, and application shutdown paths must release their cursors, MongoClient instances, SSH tunnels, workers, subscriptions, and caches.
- Cancellation must do more than stop waiting. Terminate or isolate underlying work and late callbacks so they cannot mutate state after cancellation.
