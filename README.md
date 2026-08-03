# AMDM (Another Mongo Desktop Manager)

[English](./README.md) | [中文](./README_CN.md)

A lean, performance-first MongoDB desktop GUI, powered by Electron.

> Still under development — don't use it for anything important; no liability for data loss.

## Run

```bash
pnpm install         # uses pnpm
pnpm dev             # launch the app with hot reload
pnpm build           # production build into ./out
pnpm dist:dir --arm64 # package an unpacked Apple Silicon app
pnpm clean           # remove generated build files
```

## Features

- Browse databases / collections / indexes / users
- Inline document editing, multi-tab views
- A `vm`-sandboxed shell that runs mongosh-style JS (`find` / `aggregate` / `runCommand` …)
- Autocomplete, saved queries, and history
- Native import / export for JSON / CSV / XLSX / BSON
- Tree / JSON / Table result views
- Visual explain

## macOS auto-updates

macOS packages include Sparkle 2, which checks daily and downloads new releases in the background. Configure these GitHub Actions secrets before publishing:

- `SPARKLE_ED_PRIVATE_KEY`: the private key exported by Sparkle `generate_keys -x`; keep it only in GitHub Actions. AMDM uses the same public key as LocalShare, so the existing private key can be reused.

The release workflow generates and uploads `appcast-arm64.xml` and `appcast-x64.xml`.

macOS packages use ad-hoc signing and are not notarized. On first launch, Gatekeeper may require users to select Open Anyway in Privacy & Security or remove quarantine with `xattr -dr com.apple.quarantine /Applications/AMDM.app`.

## License

[MIT](./LICENSE)

> AMDM is an unofficial MongoDB client and is not affiliated with MongoDB, Inc. in any way.
