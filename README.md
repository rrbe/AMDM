# AMDM (Another Mongo Desktop Manager)

[English](./README.md) | [中文](./README_CN.md)

A lean, performance-first MongoDB desktop GUI, powered by Electron.

> Still under development — don't use it for anything important; no liability for data loss.

## Run

```bash
pnpm install         # uses pnpm
pnpm dev             # launch the app with hot reload
pnpm build           # production build into ./out
pnpm build:web       # build the private-team Web edition
pnpm dist:dir --arm64 # package an unpacked Apple Silicon app
pnpm clean           # remove generated build files
```

The Web edition requires its Node backend, reverse-proxy SSO, and a persistent volume. See [AMDM Web](./docs/WEB.md) for deployment and security requirements.

## Features

- Browse databases / collections / indexes / users
- Inline document editing, multi-tab views
- A `vm`-sandboxed shell that runs mongosh-style JS (`find` / `aggregate` / `runCommand` …)
- Autocomplete, saved queries, and history
- Native import / export for JSON / CSV / XLSX / BSON
- Tree / JSON / Table result views
- Visual explain

## macOS installation

macOS builds update through Sparkle, use ad-hoc signing, and are not notarized. On first launch, select Open Anyway in Privacy & Security or run `xattr -dr com.apple.quarantine /Applications/AMDM.app`.

## License

[MIT](./LICENSE)

> AMDM is an unofficial MongoDB client and is not affiliated with MongoDB, Inc. in any way.
