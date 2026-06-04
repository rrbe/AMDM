import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Test layers (see test/README.md):
//   test/unit/**      pure logic, node env, no mongo — CI gate
//   test/contract/**  cross-layer BSON↔EJSON round-trip — CI gate
//   test/integration/** real MongoDB via mongodb-memory-server — local
// A single mongod is shared across the run (fileParallelism: false) — no
// parallel files spinning up competing servers. Unit/contract files don't
// import the harness, so they never start mongod.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      // Track the pure logic the test framework is meant to backstop. UI
      // components, IPC wiring, and electron-bound modules are out of scope.
      include: [
        'src/renderer/src/lib/**',
        'src/main/mongo/*Core.ts',
        'src/main/mongo/uri.ts',
        'src/main/workers/serialize-core.ts',
        'src/main/store/**'
      ],
      reporter: ['text', 'html']
    }
  }
})
