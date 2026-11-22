# AGENTS.md

## Git workflow

- Write all commit messages in English and use Conventional Commits: `<type>: <summary>`.

## Releases

- `bump version <version>` authorizes the complete release flow: update and validate the version, commit and push `master`, create and push the `v<version>` tag, then monitor the Release workflow to completion.
- Maintain English `CHANGELOG.md` and Chinese `CHANGELOG_CN.md`. Before release, supply both languages for new entries in `docs/release-notes/translations.json`; GitHub Release bodies remain Chinese, and Sparkle notes follow the app language.
- Report completion only after the workflow succeeds, the GitHub Release is published, and the expected macOS, Windows, Linux, and Sparkle appcast assets are present.

## Project and documentation

- For IPC, Shell execution, BSON, or resource ownership, read [architecture.md](docs/architecture.md).
- For validation, packaging, or releases, read [development.md](docs/development.md).
- Before optimizing performance, read the [benchmark guide](benchmarks/README.md).
- For Renderer state and Electron UI validation, read [renderer.md](docs/renderer.md). For UI design and styling, use [DESIGN.md](DESIGN.md).
- Product and engineering backlog items live in [TODO.md](TODO.md).

## Engineering constraints

### Boundaries and data safety

- The Renderer must not use Node or privileged APIs. Keep privileged operations in main and expose them through the shared contract, preload, and IPC.
- On desktop, encrypt and decrypt stored credentials in main. Forms may submit user-entered secrets through typed IPC. Represent secret fields in ordinary connection reads and import previews with presence flags. A connection URL may include the MongoDB password when the user selects that option.
- Represent BSON across process boundaries as structured-cloneable EJSON-canonical values. Wire-format changes must update producers, consumers, and contract fixtures together.
- Separate pure logic from side effects. Keep core logic independently testable and place live connections, file-system access, and Electron APIs behind thin adapters.

### Performance

1. Handle unbounded data with virtualization, pagination, chunking, or streaming by default. Do not materialize it entirely in memory or the DOM unless the user explicitly requests a full operation.
2. Bound long-running database, network, and file operations and support cancellation. Set timeouts on database and network requests. Caches need capacity or lifecycle bounds and must be invalidated when their owning resource closes.
3. CPU-heavy work must not block interactive paths in the Renderer or main. Prefer workers and retain a correct, observable fallback path.
4. Load only the data and code needed for startup and frequent interactions. Fetch samples, metadata, and heavy features on demand, and do not issue implicit queries solely to decorate the UI.
5. Release owned cursors, clients, tunnels, workers, listeners, and result caches when their tab, connection, task, or application lifecycle ends.
6. Explicit full operations still need progress or busy feedback and should support cancellation where practical. Do not trade silent truncation for apparent responsiveness.
7. Budget rendering by total mounted cells and per-cell cost, not just document count. Wide tables must virtualize body columns as well as rows; off-screen cells must not eagerly initialize tooltips, listeners, or formatting work. A bounded query result alone does not guarantee responsive rendering.
8. View and tab switches are performance-sensitive interactions. Keep synchronous rendering and transformation work bounded, preserve per-result UI state across remounts, and keep focused editors, pinned columns, and active drag targets stable during virtualization.

## Validation scope

- Run the checks for the affected change in [development.md](docs/development.md#validation-by-change-type). Reuse valid local results when the tested code is unchanged.
- Verify main/preload/worker runtime and packaging changes in the unpacked app. For main-process dependencies, inspect and launch the artifact for the target architecture.
- Run local benchmarks when explicitly requested or when a complex performance change or regression warrants measurement. For data-view or virtualization changes that warrant profiling, measure switching and scrolling in Electron with representative wide, nested results and compare mounted cell counts and timings.
