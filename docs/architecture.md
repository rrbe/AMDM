# Architecture and Cross-Layer Contracts

This document records constraints that span multiple directories and are difficult to verify from a single file. Source code and tests remain authoritative for specific APIs and compatibility lists.

## Process boundaries

- `src/main/` owns MongoDB connections, SSH, file-system access, secure storage, Shell execution, and workers.
- `src/preload/` exposes only the typed `window.api`; the Renderer must not access Node or `ipcRenderer` directly.
- `src/shared/` defines cross-process channels and wire types. Renderer-side asynchronous operations are centralized in the store.

The typical call chain is: store action → `window.api` → preload → IPC handler → main service. When changing IPC, check the shared contract, preload, handler, caller, and relevant tests together; never update only one end of the chain.

The Web edition implements the same Renderer API through authenticated HTTP RPC and SSE. Result ownership includes the user, page, and storage mode. See [AMDM Web](web.md) for storage, page cleanup, and deployment requirements.

## Application updates

- macOS delegates scheduling and installation to Sparkle. The app selects the feed for its architecture and language and verifies downloaded updates with Sparkle. Windows and Linux start downloads after an explicit user action, and main owns progress, cancellation, and installation state.
- For required installer metadata, signed deltas, and full archives, see [Update artifacts](development.md#update-artifacts).

## Testability

Keep transformation, validation, and planning logic in cores that do not depend on Electron or live connections. Session, IPC, file-system, and system APIs should remain thin adapters. Add unit tests for new core logic and integration tests for cross-layer write paths or handlers.

## Shell compatibility layer

All query tabs, history entries, and saved queries run through the official Mongosh evaluator. Scripts can access the Node Driver on the selected database through `driverDb`. See [Mongosh compatibility](mongosh-compatibility.md) for script examples and environment limits.

Each execution owns its provider listeners, cursors, and sessions. Document results retain their cursor until exhaustion or result closure; already-read pages are EJSON-canonical chunks in a private temporary directory. Paging and display-size changes read this execution's cursor/cache without evaluating the script again. Closing or evicting a result, closing its tab or Renderer, and disconnecting its connection release the cursor, sessions, listeners, and files without suspending the shared `MongoClient`. Renderer completion handlers must still match the tab's current `execId`, so a closed or superseded tab cannot receive late results, notifications, or database-switch state.

Query `limit`/`skip` remain database semantics; the display page size only bounds each IPC response. Ordinary unconsumed find cursors count their original filter with query skip/limit, collation, hint, and read preferences in a separate bounded operation. Aggregations, consumed cursors, and find options that cannot be counted equivalently show an unknown total until exhaustion. Count failures are explicit and do not fail the data result. Explicit refresh starts a new execution on page one and keeps its display size.

The result's `collection` is a display hint. Editing, deletion, and refresh by ID require `documentSource`, which records the database and collection of a direct document read with intact IDs and field paths. Each page of the execution carries the same source.

- Preserve official positional arguments, completion values, and implicit-await behavior.
- Errors created inside `vm` come from another realm. Extract details structurally.
- Bound results by default. Materialize a complete cursor only when explicitly requested.
- Never retry a failed script automatically: it may already have written data.

## Serialization and output

- Encode BSON results from main as EJSON-canonical values. `serialize-core.ts` produces the wire format, while `renderer/src/lib/ejson.ts` interprets it. Adding a BSON type requires coordinated changes to both sides and `test/fixtures/bson-corpus.ts`.
- Workers and inline fallbacks must reuse the same pure core so formats cannot diverge between runtimes. Confirm buffer ownership before transferring binary buffers; buffers backed by Node's shared allocation pool must not be added directly to a transfer list.
- Console output still uses a one-shot result protocol, so its line limit must remain. Remove that limit only after implementing end-to-end chunked transport, Renderer virtualization, complete-result caching, and Copy All support.

## State and resource ownership

- Desktop credential storage belongs to main. When Electron secure storage is unavailable, the current fallback saves credentials using reversible Base64 encoding. Such profiles contain unencrypted credentials. Ordinary connection reads expose only presence flags for secret fields.
- Desktop connection transfers use owner-scoped, expiring import previews. Imported
  source text and decrypted credentials stay in main; the Renderer receives only
  sanitized rows, secret-presence flags, and validation messages. Export writes
  directly to a native-selected file or the system clipboard. AMDM backups may
  encrypt the entire payload; client-specific exports follow that client's format.
  Import validates the entire selection before atomically replacing the connection
  file. New connections retain source order and receive unique names; replacement
  requires a disconnected target and clears credentials absent from the source.
  SSH private keys and TLS certificate files are referenced by path, never bundled.
- The component that creates a resource owns its cleanup. Connection, tab, task, and application shutdown paths must release their cursors, MongoClient instances, SSH tunnels, workers, subscriptions, and caches.
- Closing the last desktop workspace window exits the application, including on macOS. Window close and application quit share a native confirmation (enabled by default and configurable in Settings → General) when connections are live/pending or the workspace contains query text, results, running queries, or multiple tabs. Cancelling preserves the workspace. Confirmation precedes cleanup; shutdown blocks new connections/queries and awaits connection/result cleanup before destroying windows. Settings windows do not count as workspaces. Query tabs are not restored on relaunch.
- Disconnecting releases the live catalog, while the Renderer retains a namespace-only snapshot for search during the current app session. Successful reconnection and connection deletion discard that snapshot. Directory search includes loaded descendants regardless of expansion; it does not fetch missing namespaces or persist offline snapshots.
- Quick Search indexes loaded catalog metadata, open tabs, saved queries, and history. Keep credentials and result documents out of the search index, and query text out of persisted recent visits. Closing search releases its worker and index.
- Cancellation must do more than stop waiting. Terminate or isolate underlying work and late callbacks so they cannot mutate state after cancellation.
