# Development, Testing, and Packaging

## Package management

- Use pnpm exclusively; `package.json#packageManager` pins the version.
- `.npmrc` uses a hoisted layout for compatibility with Electron and externalized dependencies.
- pnpm v10 blocks dependency build scripts by default. When adding a package that compiles native code or downloads a binary, review and update `pnpm.onlyBuiltDependencies`.
- Documentation must reference scripts that exist in the current `package.json#scripts`. Check Markdown and workflows whenever a script is added, renamed, or removed.

## Test layers

- Unit: pure logic with no MongoDB dependency.
- Contract: BSON ↔ EJSON and other cross-layer wire formats.
- Integration: Shell, write paths, and core operations validated against real MongoDB behavior.
- Packaged smoke: native Electron startup, preload/IPC boundaries, transactions,
  BSON, workers, and updater initialization (`pnpm test:packaged`).
- Core UI E2E: real Electron input to connect through Explorer, execute queries
  using Run/the keyboard shortcut, and render JSON/Table (`pnpm test:e2e:smoke`).
- Full UI E2E: core smoke plus pagination/write-once behavior, Settings isolation,
  quick search, and Web scenarios (`pnpm test:e2e`).
- Benchmarks: repeated production builds and packaged startup/query timings
  (`pnpm bench:build`, `pnpm bench:runtime`) plus native quick-search UI latency
  (`pnpm bench:search`), with raw samples and summaries.

Test files are outside the application tsconfig includes, so `pnpm typecheck` does
not replace tests. During local development, type-check TypeScript changes and
run only the affected unit/contract test files. Add relevant integration tests
when MongoDB behavior, writes, or IPC handlers change. For example:

```bash
pnpm typecheck
pnpm exec vitest run test/unit/main/stores.test.ts
# IPC changes that affect connection handling:
pnpm exec vitest run test/integration/connectionsIpc.test.ts
```

Full suites run in CI. Do not rerun them for every feature, commit, or push when
the affected code already has valid results. Documentation-only changes need
link/reference checks and `git diff --check`; routine UI changes do not require
packaging or E2E. Run the relevant native UI scenarios for complex interactions
or an observed regression, and packaged smoke for runtime/packaging changes.

Integration tests prefer a locally cached `mongod` binary and may need to download one when no cache exists. Worker artifacts are generally not built during tests, so worker-backed modules must support an inline path through the same core.

The `CI` workflow runs on pushes to `master` and on pull requests, using one
Linux runner for type checking, unit/contract and integration tests, desktop/Web
production builds, Web runtime tests, native packaging, and core UI E2E.
Changes limited to Markdown or
`docs/screenshots/` skip this workflow. Feature branch pushes do not trigger a
second run alongside PR checks. New runs for the same PR cancel older runs;
`master` push runs remain independent. Version tags trigger Release only.

`Daily checks` runs once a day at 03:17 Asia/Shanghai (19:17 UTC) against the
latest `master`, and supports manual runs from Actions or
`gh workflow run daily.yml --ref <branch>`. Scheduling and manual dispatch become
available after the workflow is merged into `master`. The scheduled time is a
target; GitHub may delay a run when runners are busy.

The daily/manual workflow retains the full macOS, Windows, and Linux suite:
type checking, unit/contract and integration tests, desktop/Web builds, Web
runtime, native packaging, packaged smoke, full UI E2E (including core smoke),
and build/runtime benchmarks.
Both workflows cache MongoDB 8.2.1. Daily packaging targets the host architecture
using the installed Electron distribution. `pnpm test:packaged`
then launches that unpacked application with isolated user data and uses Electron
CDP to verify both window bridges, concurrent first queries, transactions, BSON,
the serializer worker, and updater initialization. Linux uses Xvfb. Runtime
diagnostics are written under `dist/runtime-validation/` and uploaded by the
daily/manual workflow.
On macOS, the shared packaged-test launcher uses `--use-mock-keychain` to keep
ad-hoc test builds from blocking on system Keychain authorization prompts.

Both workflows explicitly run `pnpm exec install-electron`, then
`pnpm package:dir` to package the existing build for the host platform and
architecture using `node_modules/electron/dist`. This packaging command expects
`pnpm build` first and `pnpm prepare:sparkle` on macOS; it does not rebuild or
clean output. Unit tests do not install the Electron binary.

PR smoke reports, Electron logs, and screenshots are uploaded from
`dist/e2e-validation/smoke-shell/`, including on failure.

Keep new core E2E small and focused on essential user paths. Broader UI cases
belong to full regression. Each scenario owns its profile, MongoDB fixture, app,
and diagnostics; shared setup/cleanup lives in `test/helpers/`. Shell execution,
pagination, and Settings are separate tests and can each run by name:

```bash
pnpm test:e2e:smoke
node --test --test-name-pattern='Shell pagination' test/e2e/shell.test.mjs
node --test --test-name-pattern='Settings opens' test/e2e/shell.test.mjs
```

The daily/manual UI E2E runs on all three platforms, with reports, Electron logs,
and screenshots under `dist/e2e-validation/`. Test files run serially because native
Electron windows share desktop focus; parallel instances can disrupt mouse,
keyboard, and focus assertions. Build and runtime benchmarks run with
three iterations in the daily/manual workflow and upload their reports under
`dist/benchmarks/`.
Functional failures fail CI; benchmark timings are recorded without absolute
performance thresholds because shared runner load varies.

E2E and runtime benchmarks require an unpacked native application first. On
macOS arm64, prepare it with `pnpm dist:dir --mac --arm64
--config.electronDist=node_modules/electron/dist`, then run `pnpm test:e2e` or
`pnpm bench:runtime`. These commands use isolated temporary profiles and a local
MongoDB replica set. They do not install the test application.

See [benchmarks/README.md](../benchmarks/README.md) for repeatable comparisons,
parameters, measurement boundaries, and where to extend the scenarios. Electron
CDP, input, native artifact discovery, and process cleanup are shared in
`test/helpers/packagedElectron.mjs` by smoke, E2E, and runtime benchmarks.

## Local macOS installation

The minimum supported macOS version is 13 Ventura for both arm64 and x64. The app bundle declares `minimumSystemVersion: "13.0"` in `electron-builder.yml`, and the native Sparkle addon uses `-mmacosx-version-min=13.0` for both architectures, matching Electron 44's minimum requirement.

`pnpm install:mac` builds and installs the arm64 app using the Electron distribution already installed in `node_modules/electron/dist`. Install dependencies first with `pnpm install` on an Apple Silicon Mac. This local command avoids Electron archive downloads and online checksum requests during packaging; it still builds the app and signs the bundle. Sparkle is downloaded only when its prepared framework is missing or its pinned version changes.

## Main-process dependency packaging

Electron packages only `out/main/`, `out/preload/`, and `out/renderer/`.
Web builds remain in `out/web/` and `out/web-server/`; existing Web output does
not enter desktop packages. The packaged runtime check verifies this boundary.

The package uses `type: module`. Electron Vite emits ESM for main and workers,
and `out/preload/index.mjs` for preload (Electron requires `.mjs` for ESM
preloads). Application TypeScript uses `ESNext` with `Bundler` resolution.
Use `import.meta.dirname` or file URLs for runtime paths. Native Sparkle loading
and the official mongosh dependencies use `createRequire` at their boundaries.

When electron-builder reconstructs the dependency tree from a pnpm lockfile, it can omit leaf runtime dependencies of pure JavaScript packages. If a packaged app reports `Cannot find module`:

1. Trace the complete runtime `require()` chain from the actual main-process import entry point.
2. Add the required entry packages and runtime chain to `main.build.externalizeDeps.exclude` in `electron.vite.config.ts`; do not inline only the leaf named by the error.
3. Run `pnpm dist:dir` for the target architecture, confirm that `out/main/index.js` no longer externalizes the chain, and launch the unpacked app.

Do not treat packages with native bindings as pure JavaScript dependencies. Confirm their ABI, target architecture, and electron-builder collection behavior first.

`pnpm build:mongosh-runtime` manually rebuilds `out/main/mongosh-runtime.mjs` as an ESM bundle. Its `createRequire` banner supports dynamic Node built-in imports in the official CommonJS dependencies. Because the official Compass provider rejects explicit new connections such as `new Mongo(uri)`, the build excludes its unreachable connection/OIDC/SSH stack. The main Electron Vite build invokes the same script from its `closeBundle` hook after writing `out/main`; this ordering applies to production and development builds and prevents Electron Vite's output cleanup from removing the companion artifact. Integration tests build it from their pre-script before importing the runtime.

## Update artifacts

The release workflow publishes more than the interactive installers:

- macOS: arm64/x64 ZIP and DMG files, `appcast-*.xml`, and the EdDSA-signed `.delta` files referenced by each appcast.
- Windows: the NSIS installer, `latest.yml`, and its `.blockmap`.
- Linux: the AppImage and `latest-linux.yml`; electron-builder embeds the blockmap in the AppImage.

`scripts/generate-sparkle-appcast.mjs` downloads the three most recent full ZIPs from the previous appcast before generating the next macOS feed. Historical release ZIPs must remain available. Windows/Linux update metadata is emitted because their electron-builder targets declare the public GitHub provider even when packaging uses `--publish never`; the release job uploads it later.

## Release notes and changelog

The tag-triggered Release workflow generates notes from Git commit subjects between
published release tags, including direct master commits and commits merged through
PRs. Merge commits and version/changelog bookkeeping are excluded. `feat`, `fix`,
and `perf` are grouped separately; all other subjects remain under other updates.
Release entries are translated in `docs/release-notes/translations.json`, keyed by the
commit summary after removing the Conventional Commit type (scope and breaking-change
markers are retained). Each entry must contain reviewed `en` and `zh` text. Before
releasing, add translations for every new entry; the notes job fails on missing
translations. Commit language does not determine the displayed language.

The generator writes English `CHANGELOG.md`, Chinese `CHANGELOG_CN.md`, a Chinese
GitHub Release body, and English/Chinese Sparkle HTML. Dates follow tagged commits,
so reruns produce the same notes. Stable versions include changes from prereleases.
Sparkle displays the target version and up to two preceding stable releases.
HTML is escaped before embedding in the appcast.

macOS publishes `appcast-arm64.xml` / `appcast-x64.xml` in English and
`appcast-arm64-cn.xml` / `appcast-x64-cn.xml` in Chinese. Both language feeds share
the same signed archives and deltas. The native updater selects the feed from
`AppSettings.language`: English uses the English feed; both Chinese settings use
the Chinese feed; system mode uses the same locale resolution as the renderer.
Changes take effect on the next update check; an already open native window keeps
its current content. Sparkle's native buttons follow macOS localization separately.
`SPARKLE_RELEASE_NOTES` points to `sparkle-notes.html`; its sibling
`sparkle-notes-cn.html` is also required. Historical full ZIP URLs must retain the
release tag from their filenames, even when Sparkle rewrites the download prefix.

After publishing succeeds, a serialized job rebuilds both changelogs from all
published releases and commits them to master. Unpublished/draft releases do not
appear. A failed changelog job can be rerun without rebuilding or republishing the
installers. Branch rules must allow the workflow token to push this docs commit;
the job uses normal pushes and rebases over concurrent master commits. The
workflow token's push does not recursively trigger another workflow run.

To regenerate locally with the GitHub CLI authenticated and all tags available:

```bash
gh api --paginate --slurp 'repos/rrbe/AMDM/releases?per_page=100' > /tmp/amdm-releases.json
node scripts/generate-release-notes.mjs --releases /tmp/amdm-releases.json --changelog CHANGELOG.md --changelog-cn CHANGELOG_CN.md
# Preview a tagged release and its Chinese body and bilingual Sparkle HTML:
node scripts/generate-release-notes.mjs --releases /tmp/amdm-releases.json --tag v26.9.2 --output /tmp/amdm-release-notes
```

Both changelogs are generated. Update the translation catalog before release;
do not edit generated Markdown directly. GitHub Releases remain Chinese and do
not switch with the app language. The first entry includes all commits reachable
from the first published tag.

## Validation by change type

| Change                           | Local validation                                                     |
| -------------------------------- | -------------------------------------------------------------------- |
| Documentation                    | Link/reference checks and `git diff --check`                         |
| GitHub Actions workflows          | `actionlint` and `git diff --check`                                  |
| TypeScript or UI logic            | `pnpm typecheck` and affected unit/contract test files                |
| MongoDB behavior, writes, or IPC  | The above plus relevant integration test files                       |
| Build configuration or main deps  | The above plus `pnpm build`, target unpacked app, and packaged smoke  |
| Renderer interaction or styling   | Relevant checks; inspect Electron when runtime validation is needed |

## Internal Web edition

`pnpm dev:web` starts the shared Renderer and the Web RPC adapter with HMR.
`pnpm build:web` builds the browser client, Node server, serializer worker, and
isolated mongosh runtime; `pnpm start:web` starts that server.
`pnpm test:web` launches the compiled server against MongoDB from an isolated
working directory and checks HTTP, pagination, workers, and shutdown. See
[AMDM Web](WEB.md) for SSO, persistence, capabilities, and deployment.
