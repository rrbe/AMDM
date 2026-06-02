# Mongo Shell GUI

A lean, performance-first MongoDB desktop GUI — a personal alternative to NoSQLBooster.
See [SPEC.md](./SPEC.md) for the full plan and [docs/adr/](./docs/adr/) for the key decisions.

## Stack

Electron + React + TypeScript + Vite (via `electron-vite`). Official MongoDB Node
driver in the main process; the shell runs user JS in a `vm` sandbox and returns
typed BSON. Secrets are encrypted with Electron `safeStorage` (macOS Keychain).

## Run

```bash
pnpm install         # uses pnpm (see .npmrc + packageManager field)
pnpm dev             # launch the app with hot reload
pnpm typecheck       # type-check main + renderer
pnpm build           # production build into ./out
```

> Uses **pnpm**. pnpm v10 blocks dependency build scripts by default; `electron`
> and `esbuild` are allow-listed via `pnpm.onlyBuiltDependencies` in package.json
> so their binaries install. `.npmrc` sets `node-linker=hoisted` for Electron.

## Architecture (Phase 1)

```
src/
├── shared/              # IPC contract shared by both processes
│   ├── types.ts         # Connection/Catalog/Shell types
│   └── ipc.ts           # channel names + window.api shape
├── main/                # Electron main process (Node)
│   ├── index.ts         # app bootstrap + BrowserWindow
│   ├── ipc/             # ipcMain handlers
│   ├── store/           # connection persistence + Keychain secrets
│   ├── ssh/             # SSH tunnel (ssh2)
│   └── mongo/           # driver wrapper, session manager, catalog, shell engine
├── preload/             # contextBridge → window.api
└── renderer/            # React UI (sidebar, catalog tree, shell, result views)
```

## Performance rules (non-negotiable — see ADR-0004)

Virtualize every large list/tree/table · stream cursors with bounded pages ·
heavy work off the main thread · lazy/bounded schema sampling · no auto-query on
collection open · dispose editor models + result buffers on close.

## Phase 1 scope

Connection management (SCRAM / SSH tunnel / TLS / replica set) · browse
databases / collections / indexes / users · run `find` / `aggregate` in the shell
· Tree / JSON / Table result views (virtualized).

> Phase 2: autocomplete, saved queries + history, visual explain, document edit/delete.
> Phase 3: import/export (JSON/CSV/XLSX native + BSON via official tools), connection color groups, polish.
