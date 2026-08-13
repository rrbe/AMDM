# AGENTS.md

This file contains only repository-level non-negotiable rules. Read the relevant files under `docs/` for implementation details, and do not duplicate information that is easy to discover through code search.

## Git workflow

1. Commit only when the user explicitly asks; otherwise leave changes in the working tree.
2. Use Conventional Commits: `<type>: <summary>`.
3. Work directly on `master`; do not create feature branches or pull requests, and never force-push.

## Releases

- `bump version <version>` authorizes the complete release flow: update and validate the version, commit and push `master`, create and push the `v<version>` tag, then monitor the Release workflow to completion.
- Report completion only after the workflow succeeds, the GitHub Release is published, and the expected macOS, Windows, Linux, and Sparkle appcast assets are present.

## Project and documentation

AMDM is a performance-first MongoDB desktop GUI built with Electron, React, TypeScript, and Vite.

Read the documentation relevant to the task:

- [docs/architecture.md](docs/architecture.md): process boundaries, IPC, Shell, serialization, and persistence contracts.
- [docs/development.md](docs/development.md): package management, testing, packaging, and tooling pitfalls.
- [docs/renderer.md](docs/renderer.md): state management, styling migration, and Electron UI validation.
- [DESIGN.md](DESIGN.md): design system; [TODO.md](TODO.md): current backlog.

## Common commands

Treat `package.json#scripts` as the source of truth. Update the documentation when scripts change, and do not retain removed commands.

```bash
pnpm install                       # install dependencies
pnpm dev                           # start the app with hot reload
pnpm typecheck                     # type-check main and renderer
pnpm test:unit                     # unit + contract tests (CI gate)
pnpm test:integration              # integration tests with real MongoDB behavior
pnpm test                          # run all tests
pnpm build                         # production build into out/
pnpm dist:dir --mac --arm64        # build an unpacked macOS arm64 app
pnpm install:mac                   # build, install, and launch the local macOS app
pnpm clean                         # remove generated artifacts
```

Use pnpm exclusively. The project has no linter; the default validation gates are `pnpm typecheck` and `pnpm test:unit`.

## Engineering constraints

### Boundaries and data safety

- The Renderer must not use Node or privileged APIs. Keep privileged operations in main and expose them through the shared contract, preload, and IPC.
- Decrypt and use passwords, private-key passphrases, and other secrets only in main. Never persist them as plaintext or send them over IPC.
- Represent BSON across process boundaries as structured-cloneable EJSON-canonical values. Wire-format changes must update producers, consumers, and contract fixtures together.
- Separate pure logic from side effects. Keep core logic independently testable and place live connections, file-system access, and Electron APIs behind thin adapters.

### Performance

1. Handle unbounded data with virtualization, pagination, chunking, or streaming by default. Do not materialize it entirely in memory or the DOM unless the user explicitly requests a full operation.
2. Database, network, and file operations must be bounded, cancellable, and time-limited. Caches need capacity or lifecycle bounds and must be invalidated when their owning resource closes.
3. CPU-heavy work must not block interactive paths in the Renderer or main. Prefer workers and retain a correct, observable fallback path.
4. Load only the data and code needed for startup and frequent interactions. Fetch samples, metadata, and heavy features on demand, and do not issue implicit queries solely to decorate the UI.
5. Release owned cursors, clients, tunnels, workers, listeners, and result caches when their tab, connection, task, or application lifecycle ends.
6. Explicit full operations still need progress or busy feedback and should support cancellation where practical. Do not trade silent truncation for apparent responsiveness.

## Validation scope

- Run the relevant integration tests for changes to real MongoDB behavior, write paths, or IPC handlers.
- Run a production build for dependency, main-build, or packaging changes. For main-process runtime dependencies, also inspect and launch the unpacked artifact for the target architecture.
- Validate UI behavior against the current Electron Renderer with Electron DevTools/CDP, including DOM, computed styles, events, focus, and scrolling. A regular Chrome page is not a substitute.
