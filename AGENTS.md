# AGENTS.md

This file contains only repository-level non-negotiable rules. Read the relevant files under `docs/` for implementation details, and do not duplicate information that is easy to discover through code search.

## Git workflow

1. Commit only when the user explicitly asks; otherwise leave changes in the working tree.
2. Write all commit messages in English and use Conventional Commits: `<type>: <summary>`.
3. Work directly on `master`; do not create feature branches or pull requests, and never force-push.

## Releases

- `bump version <version>` authorizes the complete release flow: update and validate the version, commit and push `master`, create and push the `v<version>` tag, then monitor the Release workflow to completion.
- Maintain English `CHANGELOG.md` and Chinese `CHANGELOG_CN.md`. Before release, supply both languages for new entries in `docs/release-notes/translations.json`; GitHub Release bodies remain Chinese, and Sparkle notes follow the app language.
- Report completion only after the workflow succeeds, the GitHub Release is published, and the expected macOS, Windows, Linux, and Sparkle appcast assets are present.

## Project and documentation

AMDM is a performance-first MongoDB desktop GUI built with Electron, React, TypeScript, and Vite.

The current Electron capability baseline is Electron 44 (`electron@^44.9.1`). Keep this line synchronized with Electron upgrades.

Read the documentation relevant to the task:

- [docs/architecture.md](docs/architecture.md): process boundaries, IPC, Shell, serialization, and persistence contracts.
- [docs/development.md](docs/development.md): package management, testing, packaging, and tooling pitfalls.
- [benchmarks/README.md](benchmarks/README.md): performance measurements, before/after comparisons, and reusable Electron test infrastructure. Read this before performance optimization.
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
pnpm test                          # unit + contract + integration tests
pnpm test:packaged                 # smoke-test the native unpacked app
pnpm test:e2e                      # real Electron UI flows (requires unpacked app)
pnpm test:e2e:smoke                # core UI flow used by PR CI (requires unpacked app)
pnpm bench:build                   # repeated production builds and output sizes
pnpm bench:runtime                 # packaged startup and Shell IPC timings
pnpm bench:search                  # packaged quick-search UI latency under pressure
pnpm build                         # production build into out/
pnpm dist:dir --mac --arm64        # build an unpacked macOS arm64 app
pnpm package:dir                   # package existing output with the installed Electron
pnpm install:mac                   # build, install, and launch the local macOS app
pnpm clean                         # remove generated artifacts
```

Use pnpm exclusively. The project has no linter. Choose type-checking and targeted tests according to the change; full test suites run in CI.

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
7. Budget rendering by total mounted cells and per-cell cost, not just document count. Wide tables must virtualize body columns as well as rows; off-screen cells must not eagerly initialize tooltips, listeners, or formatting work. A bounded query result alone does not guarantee responsive rendering.
8. View and tab switches are performance-sensitive interactions. Keep synchronous rendering and transformation work bounded, preserve per-result UI state across remounts, and keep focused editors, pinned columns, and active drag targets stable during virtualization.

## Validation scope

- Use three validation layers: local development runs affected tests; PR/master CI runs necessary checks plus a small, stable core E2E suite on Linux; daily/manual CI runs full regression on macOS, Windows, and Linux, including core E2E, extended UI cases, packaged smoke, and benchmarks.
- Keep core E2E focused on startup, connection, query execution, and result rendering. Put broader interaction and feature regressions in the full suite. Every E2E scenario must run independently with its own profile, data, and application lifecycle; reuse shared setup/cleanup, and keep native Electron scenarios serial because they share desktop focus.
- During local development, run only test files relevant to the current change. Reuse valid results when the tested code has not changed; a commit or push alone is not a reason to rerun tests. Full suites belong in CI, not the default local gate. Documentation-only changes do not need tests.
- Run the relevant integration tests for changes to real MongoDB behavior, write paths, or IPC handlers.
- Run a production build for dependency, main-build, or packaging changes. For main-process runtime dependencies, also inspect and launch the unpacked artifact for the target architecture.
- Run `pnpm test:packaged` for main/preload/worker runtime or packaging changes. E2E is not a default local gate: run only relevant scenarios when explicitly requested or when a change is complex enough to warrant end-to-end verification. Routine UI adjustments do not require rebuilding the app and running E2E each time.
- Benchmarks are run periodically by the user. Do not run them automatically for every feature, UI adjustment, or commit; run them locally only when explicitly requested or when a complex performance change or regression makes measurement worthwhile.
- When benchmarks are warranted, reuse or extend the existing benchmarks and `test/helpers/packagedElectron.mjs`. Collect repeated before/after samples on the same machine with equivalent data, settings, build mode, and cache state; retain raw reports outside `dist/` when rebuilding. State the measurement boundary: Shell IPC timings do not measure result rendering or scrolling.
- When runtime UI verification is warranted, use the current Electron Renderer with Electron DevTools/CDP to inspect relevant DOM, computed styles, events, focus, and scrolling. A regular Chrome page is not a substitute. This does not make automated E2E a requirement for every UI change.
- For complex changes to data views, shared per-cell components, or virtualization that warrant performance validation, profile view switching and scrolling in Electron with representative wide and nested results. Compare before/after timings and mounted cell/DOM counts using the same data, viewport, and build mode. Passing type checks and tests is not evidence of acceptable interaction latency; investigate measured bottlenecks before choosing an optimization.

## Strict Rules

- Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining
- Avoid designs that cause the page to flicker—for example, changes in modal height when switching tabs, or shifts in the position of a drop-down menu as the user scrolls through its options.
