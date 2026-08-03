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

- `SPARKLE_PUBLIC_ED_KEY`: the public Sparkle key, also embedded into the app bundle.
- `SPARKLE_PRIVATE_ED_KEY`: the private key exported by Sparkle `generate_keys -x`; keep it only in GitHub Actions.
- `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD`: the Developer ID Application certificate and password used to sign macOS packages in GitHub Actions.

The release workflow generates and uploads `appcast.xml`. Local macOS packaging also requires `SPARKLE_PUBLIC_ED_KEY`.

Production distribution also requires an Apple Developer ID signature (`CSC_LINK` / `CSC_KEY_PASSWORD`) and notarization credentials; local ad-hoc packages only validate the bundle wiring and are not valid updater tests.

## License

[MIT](./LICENSE)

> AMDM is an unofficial MongoDB client and is not affiliated with MongoDB, Inc. in any way.
