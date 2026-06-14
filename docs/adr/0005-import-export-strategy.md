# Import/export: native for JSON/CSV/XLSX, wrap official tools for BSON (on-demand, not bundled)

**Status:** superseded in part (2026-06) — the BSON-via-external-tools decision below was reversed; BSON is now handled natively in-process (see "As rebuilt (2026-06): native BSON" at the end). The native JSON/CSV/XLSX strategy still stands.

User needs bidirectional import/export in JSON/EJSON, CSV, XLSX, and BSON (mongodump/restore compatible).

- **JSON/EJSON, CSV, XLSX** are implemented **natively in-process**: stream documents via the existing Node-driver connection (reusing auth + SSH tunnel), serialize with the `bson` EJSON helpers for JSON/EJSON and `exceljs` for both CSV and XLSX (one dep covers both). No external binary, no second connection to configure.
- **BSON** requires byte-for-byte `mongorestore` compatibility, which is impractical to reimplement, so we **wrap the official MongoDB Database Tools** (`mongodump`/`mongorestore`/optionally `mongoexport`/`mongoimport`), pointing them at the SSH-forwarded local port when a tunnel is active.

The tools are **not bundled** in the base installer (would add ~50–80MB per platform, against the lean ethos). Instead: auto-detect an installed copy (PATH + common Homebrew dirs `/opt/homebrew/bin`, `/usr/local/bin` — needed because a GUI-launched app doesn't inherit the shell PATH). If absent, BSON is disabled in the UI and operations return an actionable install hint (`brew install mongodb-database-tools`); native formats keep working.

**As built (Phase 3):**
- BSON export uses `mongodump --archive=<file>` (a single restorable archive), not a per-collection `.bson` directory; the query filter is passed via `--query`.
- BSON import uses `mongorestore --archive=<file>` and restores to the archive's **original namespace** (the chosen target db/collection is not remapped) — surfaced as a warning in the UI.
- Download-on-demand of the matching tool version is **deferred** (TODO); detect-or-instruct is the current behavior.
- Native CSV/XLSX go through `exceljs` (one dep covers both read + write); CSV/XLSX buffer the bounded result to derive columns, while JSON streams.

## Considered options

- **Bundle the tools in the installer** — works offline out-of-the-box, but bloats the base download and couples release cadence to tool versions. Reversible if the user later prefers zero first-run friction over size.
- **Reimplement BSON dump natively** — avoids the binary, but matching the mongodump *archive* format exactly is high-risk and low-value. Rejected at first — but later **adopted in a narrower form** (the plain per-collection `.bson` format, not the archive stream); see the rebuild note below.

## Consequences

Per-document/EJSON "BSON-ish" export is NOT the same as a mongodump archive; only the wrapped tools produce restore-compatible output. SSH-tunnel export path must pass the local forwarded host/port to the subprocess.

## As rebuilt (2026-06): native BSON, no external tools

The "wrap mongodump/mongorestore" decision was **reversed**. BSON import/export is now done **in-process** using the already-present `bson` package — no `mongodump`/`mongorestore` dependency, no download-on-demand, no bundling.

**Why the reversal:**
- **Bundling** the tools would add ~18MB/platform to every download (measured: `mongodump`+`mongorestore` ≈ 35MB on disk, ≈18MB compressed, macOS arm64 v100.17.0) **plus** macOS code-signing + notarization of third-party Mach-O binaries — real release cost against the lean ethos.
- **Download-on-demand** is the heaviest path to build (per-os/arch URL resolution, fetch, verify, extract, cache, version-pin) for a low-frequency feature.
- The original "byte-for-byte archive compat is impractical to reimplement" concern was specifically about the `--archive` **stream** format. We sidestep it by using the **plain `.bson`** format instead — a flat sequence of length-prefixed BSON documents, exactly what `mongodump --out <dir>` writes per collection and what `mongorestore <file>.bson` reads. So our files remain **interoperable both ways** with the official tools, without reimplementing the archive framing.

**As rebuilt:**
- Export streams the bounded cursor through `BSON.serialize` to a plain `.bson` file (memory-bounded, ADR-0004 #2), with an optional gzip (`.bson.gz`). The query filter **and** `limit` now both apply.
- Import reads the file (gzip auto-detected by magic bytes), parses documents with `promoteValues:false` (numeric-subtype fidelity), and inserts them into the **chosen target db/collection** — the previous "archive restores to its original namespace" caveat is gone, which also makes the deferred namespace-remap TODO moot.
- Pure codec in `bsonFileCore.ts`; the electron-free streaming writer in `bsonWriteCore.ts`; both covered by unit + integration tests (real `mongod`, asserting ObjectId/Int32/Long/Decimal128/Binary/Date fidelity + gzip round-trips). The tool-detection plumbing (`tools.ts`, `connArgs.ts`, `tools:status` IPC, `ToolStatus`) was deleted.
- **Not carried over:** index/collection metadata (a real `mongodump` writes a sidecar `.metadata.json`); like our JSON/CSV/XLSX, native BSON is document data only.
- **Still not bounded on the import side:** the file is read fully into memory before insert (same shape as the native JSON/CSV/XLSX importers). Acceptable for now; incremental buffer parsing is a tracked TODO.
