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

Test files are outside the application tsconfig includes, so `pnpm typecheck` does not replace the test suite. Run type-checking and unit/contract tests for routine changes; add the relevant integration tests when real database semantics are involved.

Integration tests prefer a locally cached `mongod` binary and may need to download one when no cache exists. Worker artifacts are generally not built during tests, so worker-backed modules must support an inline path through the same core.

## Local macOS installation

The minimum supported macOS version is 12 Monterey for both arm64 and x64. The app bundle declares `minimumSystemVersion: "12.0"` in `electron-builder.yml`, and the native Sparkle addon uses `-mmacosx-version-min=12.0` for both architectures, matching Electron 43's minimum requirement.

`pnpm install:mac` builds and installs the arm64 app using the Electron distribution already installed in `node_modules/electron/dist`. Install dependencies first with `pnpm install` on an Apple Silicon Mac. This local command avoids Electron archive downloads and online checksum requests during packaging; it still builds the app and signs the bundle. Sparkle is downloaded only when its prepared framework is missing or its pinned version changes.

## Main-process dependency packaging

When electron-builder reconstructs the dependency tree from a pnpm lockfile, it can omit leaf runtime dependencies of pure JavaScript packages. If a packaged app reports `Cannot find module`:

1. Trace the complete runtime `require()` chain from the actual main-process import entry point.
2. Add the required entry packages and runtime chain to `main.build.externalizeDeps.exclude` in `electron.vite.config.ts`; do not inline only the leaf named by the error.
3. Run `pnpm dist:dir` for the target architecture, confirm that `out/main/index.js` no longer externalizes the chain, and launch the unpacked app.

Do not treat packages with native bindings as pure JavaScript dependencies. Confirm their ABI, target architecture, and electron-builder collection behavior first.

`pnpm build:mongosh-runtime` manually rebuilds the bundled official mongosh runtime in `out/main`. Because the official Compass provider rejects explicit new connections such as `new Mongo(uri)`, the build excludes its unreachable connection/OIDC/SSH stack. The main Electron Vite build invokes the same script from its `closeBundle` hook after writing `out/main`; this ordering applies to production and development builds and prevents Electron Vite's output cleanup from removing the companion artifact. Integration tests build it from their pre-script before importing the runtime.

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

| Change                           | Minimum validation                                       |
| -------------------------------- | -------------------------------------------------------- |
| Documentation or configuration   | Link/reference checks and `git diff --check`             |
| TypeScript or UI logic           | `pnpm typecheck` and `pnpm test:unit`                    |
| MongoDB behavior, writes, or IPC | The above plus relevant integration tests                |
| Build configuration or main deps | The above plus `pnpm build` and target unpacked artifact |
| Renderer interaction or styling  | The above plus validation in the current Electron app    |
