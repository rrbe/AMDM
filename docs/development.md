# Development, Testing, and Packaging

## Package management

- Use pnpm exclusively; `package.json#packageManager` pins the version.
- `.npmrc` uses a hoisted layout for compatibility with Electron and externalized dependencies.
- pnpm v10 blocks dependency build scripts by default. When adding a package that compiles native code or downloads a binary, review and update `pnpm.onlyBuiltDependencies`.
- Documentation must reference scripts that exist in the current `package.json#scripts`. Check Markdown and workflows whenever a script is added, renamed, or removed.

## Running tests locally

Use the [validation table](#validation-by-change-type) to select checks. Test files are outside the application tsconfig. When running a single integration file that uses Mongosh, build the runtime first because direct Vitest invocations skip the package pre-script:

```bash
pnpm build:mongosh-runtime
pnpm exec vitest run test/integration/shellPaging.test.ts
```

Integration tests reuse a cached `mongod` or download it on first use. Tests that exercise worker-backed code without built workers use the inline implementation.

Keep core E2E focused on startup, connection, query execution, and result rendering. Each native scenario owns its profile, fixture, and app. Run these scenarios serially because Electron windows share desktop focus. The shared launcher uses a mock keychain on macOS to avoid system prompts during ad-hoc tests.

Packaged smoke, native E2E, and runtime benchmarks require an unpacked app for the host architecture. For example, on Apple Silicon:

```bash
pnpm dist:dir --mac --arm64 --config.electronDist=node_modules/electron/dist
pnpm test:packaged
```

To package an existing build, run `pnpm build`, `pnpm prepare:sparkle` on macOS, then `pnpm package:dir` with the Electron binary installed. For repeatable performance comparisons and CDP measurement boundaries, see the [benchmark guide](../benchmarks/README.md).

[CI](../.github/workflows/ci.yml) runs core checks for pull requests and master. [Daily checks](../.github/workflows/daily.yml) runs cross-platform regression and can be triggered manually with `gh workflow run daily.yml --ref <branch>`.

## Local macOS installation

The minimum supported macOS version is 13 Ventura for both arm64 and x64. The app bundle declares `minimumSystemVersion: "13.0"` in `electron-builder.yml`, and the native Sparkle addon uses `-mmacosx-version-min=13.0` for both architectures.

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
| Dependencies or build configuration | Production build for the affected target                            |
| Desktop main/preload/worker runtime or packaging | Build, package for the target architecture, and run `pnpm test:packaged`. Inspect the artifact for changed main-process dependencies. |
| Renderer interaction or styling   | Affected checks and [Electron UI validation](renderer.md#ui-validation) for complex interactions or observed regressions |

## Internal Web edition

`pnpm dev:web` starts the shared Renderer and the Web RPC adapter with HMR.
`pnpm build:web` builds the browser client, Node server, serializer worker, and
isolated mongosh runtime; `pnpm start:web` starts that server.
`pnpm test:web` launches the compiled server against MongoDB from an isolated
working directory and checks HTTP, pagination, workers, and shutdown. See
[AMDM Web](web.md) for SSO, persistence, capabilities, and deployment.
