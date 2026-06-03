import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Tests live under test/ (outside the two app tsconfigs, so `pnpm typecheck`
// ignores them) and run against a real MongoDB via mongodb-memory-server. A
// single mongod is shared across the run — no parallel files spinning up
// competing servers.
export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') }
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000
  }
})
