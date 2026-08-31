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

## Main-process dependency packaging

When electron-builder reconstructs the dependency tree from a pnpm lockfile, it can omit leaf runtime dependencies of pure JavaScript packages. If a packaged app reports `Cannot find module`:

1. Trace the complete runtime `require()` chain from the actual main-process import entry point.
2. Add the required entry packages and runtime chain to `main.build.externalizeDeps.exclude` in `electron.vite.config.ts`; do not inline only the leaf named by the error.
3. Run `pnpm dist:dir` for the target architecture, confirm that `out/main/index.js` no longer externalizes the chain, and launch the unpacked app.

Do not treat packages with native bindings as pure JavaScript dependencies. Confirm their ABI, target architecture, and electron-builder collection behavior first.

## Update artifacts

The release workflow publishes more than the interactive installers:

- macOS: arm64/x64 ZIP and DMG files, `appcast-*.xml`, and the EdDSA-signed `.delta` files referenced by each appcast.
- Windows: the NSIS installer, `latest.yml`, and its `.blockmap`.
- Linux: the AppImage and `latest-linux.yml`; electron-builder embeds the blockmap in the AppImage.

`scripts/generate-sparkle-appcast.mjs` downloads the three most recent full ZIPs from the previous appcast before generating the next macOS feed. Historical release ZIPs must remain available. Windows/Linux update metadata is emitted because their electron-builder targets declare the public GitHub provider even when packaging uses `--publish never`; the release job uploads it later.

## Validation by change type

| Change                           | Minimum validation                                       |
| -------------------------------- | -------------------------------------------------------- |
| Documentation or configuration   | Link/reference checks and `git diff --check`             |
| TypeScript or UI logic           | `pnpm typecheck` and `pnpm test:unit`                    |
| MongoDB behavior, writes, or IPC | The above plus relevant integration tests                |
| Build configuration or main deps | The above plus `pnpm build` and target unpacked artifact |
| Renderer interaction or styling  | The above plus validation in the current Electron app    |
