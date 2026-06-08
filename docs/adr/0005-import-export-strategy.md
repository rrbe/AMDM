# Import/export: native for JSON/CSV/XLSX, wrap official tools for BSON (on-demand, not bundled)

**Status:** accepted

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
- **Reimplement BSON dump natively** — avoids the binary, but matching the mongodump archive format exactly is high-risk and low-value. Rejected.

## Consequences

Per-document/EJSON "BSON-ish" export is NOT the same as a mongodump archive; only the wrapped tools produce restore-compatible output. SSH-tunnel export path must pass the local forwarded host/port to the subprocess.
