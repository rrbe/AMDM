# Performance benchmarks

These scripts are reusable measurement tools for performance work. Keep raw
samples, compare equivalent native builds on the same machine, and change one
variable at a time. ESM/CJS is one possible comparison, not a built-in scenario.

## Commands

```bash
# Production build: five complete pnpm build runs.
pnpm bench:build
pnpm bench:build --iterations 10 --output /tmp/amdm-before-build

# Prepare a native packaged app (macOS arm64 example).
pnpm dist:dir --mac --arm64 --config.electronDist=node_modules/electron/dist

# Actual UI behavior: Explorer connection, editor typing, Run button/shortcut,
# JSON/Table results, and Settings in packaged Electron.
pnpm test:e2e

# Runtime: ten launches per cache phase, five subsequent queries per launch.
pnpm bench:runtime
pnpm bench:runtime --iterations 20 --warm-queries 10 --output /tmp/amdm-after-runtime

# Measure another already-built artifact; --app names the executable.
pnpm bench:runtime --app /path/to/AMDM.app/Contents/MacOS/AMDM --output /tmp/amdm-before-runtime
```

`--iterations` and `--warm-queries` accept integers from 1 to 50. Build and runtime
reports default to `dist/benchmarks/build/` and `dist/benchmarks/runtime/`; each run
overwrites that directory's named report/log files. Use different `--output`
directories to preserve before/after results. `pnpm clean` and `dist:prepare`
remove `dist/`, so keep comparison reports outside `dist/` when rebuilding.

On Windows/Linux, build for the host architecture with `pnpm dist:dir
--config.electronDist=node_modules/electron/dist`. Linux needs a graphical
session, or `xvfb-run --auto-servernum pnpm test:e2e` / `pnpm bench:runtime` under
Xvfb. MongoDB uses `mongodb-memory-server` with version 8.2.1 by default for runtime
benchmarks; `MONGOMS_VERSION`, `MONGOMS_DOWNLOAD_DIR`, and `MONGOMS_SYSTEM_BINARY`
can select the version/cache/local binary. Replica sets run as local processes.

## Measurements and reports

- **Build:** elapsed time of the complete `pnpm build` command, including pnpm
  startup and both Electron Vite and mongosh bundling. Output JS/CSS byte sizes
  and one log per build are recorded. It does not measure packaging/compression.
- **Startup:** process creation until the initial Renderer UI and preload bridge
  are ready. This is not full editor/autocomplete readiness.
- **First query:** Renderer IPC request until the returned result, including
  lazy mongosh loading, database evaluation, and serialization. Application-side
  elapsed time is also retained in the raw samples.
- **Subsequent queries:** repeated identical requests in the same process;
  summaries use the median of each launch's subsequent queries.
- **Compile cache:** fresh cache for each measured launch, followed by launches
  that reuse the persisted cache from the first fresh-cache sample. One extra
  warm-up launch is excluded. Fresh V8 cache does not clear OS file caches.

The runtime fixture is 200 indexed documents with 40 scalar fields and nested
values; each cursor query returns 50 documents. Every sample checks the result
count, canonical BSON values, truncation, worker startup, and runtime errors.
Profiles and compile caches are temporary and removed after the run. Debugging
is enabled consistently; compare reports collected with the same harness.

Both scripts write `report.json` and `report.md` with median, p95, min/max, sample
count, commit/working-tree state, platform, architecture, CPU, and Node metadata.
Runtime additionally records the measured `app.asar` SHA-256 and application/
Electron/Node versions, so an external artifact is not confused with the source
checkout. `samples.json` preserves progress if runtime sampling fails. Timings
have no fixed pass/fail threshold; correctness failures stop the benchmark.

This initial suite does not measure result painting, view switching, scrolling,
memory growth, or long-running database workloads. A faster IPC result is not
evidence of faster table interaction.

## Extending it

- Change the fixture and query in `runtime.mjs` to measure another database or
  serialization path; retain bounded results and correctness assertions.
- Add UI timing scenarios using `test/helpers/packagedElectron.mjs`. It provides
  native artifact discovery, isolated-profile launch, CDP attachment, DOM waits,
  real mouse input, graceful quit, and bounded process cleanup. The E2E in
  `test/e2e/shell.test.mjs` demonstrates editor keyboard input and result views.
- For rendering work, time real UI actions through animation frames, and record
  mounted cell/DOM counts, viewport, fixture shape, and build mode. Use the same
  before/after data and settings. Keep these measurements separate from IPC
  query duration.

CI runs three build iterations and three launches per cache phase, saving JSON,
Markdown, logs, and E2E screenshots as artifacts. Use more local samples for
optimization decisions; runner timings from different machines are not paired
before/after evidence.
