# Build on Electron, despite escaping NoSQLBooster

**Status:** accepted

The whole project exists because NoSQLBooster — an Electron app — became unbearably laggy. The instinct is therefore "anything but Electron." We chose Electron anyway.

Our analysis of NoSQLBooster's lag — from observed behavior, not vendor-published measurements — points to the slowness being **not the framework** but app-level choices: non-virtualized DOM rendering of result sets, eager schema-sampling on collection-open (a plausible trigger for V8 OOM), and main-thread blocking. These are hypotheses, but each is an app-level flaw we control rather than an Electron tax.

Meanwhile the two hardest parts of this app are nearly free in Electron's Node backend: (1) the official MongoDB **Node.js driver** (the reference implementation), and (2) executing the user's JavaScript shell in a `vm` context with `db` bound to that driver — both require a JS+Node runtime in the backend.

## Considered options

- **Tauri + Node sidecar** — lighter idle RAM (~80–120MB) but webview↔Rust↔Node IPC plumbing, and we'd ship Node anyway. Higher finish-risk.
- **Tauri + embedded JS engine (Rust, deno_core/quickjs)** — lightest binary, but reimplementing the JS shell + async driver bridging in Rust is the most work and highest risk.
- **Native SwiftUI** — best performance, but rebuilding the three rich Result Views by hand, Mac-locked, highest effort.

## Consequences

Electron's lag reputation is irrelevant **only if** we hold the performance line — see [0004-performance-first-architecture.md](./0004-performance-first-architecture.md). If we don't virtualize and offload heavy work, we rebuild NoSQLBooster's problem.
