import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      // exceljs and @mongosh/async-rewriter2 are bundled (not externalized) on
      // purpose: electron-builder 26's pnpm dependency collector reconstructs
      // the nested tree from the lockfile and drops some leaf transitive deps —
      // util-deprecate under exceljs's readable-stream, and ms /
      // @babel/helper-globals / @jridgewell/* under async-rewriter2's
      // @babel/core — so externalizing either crashed the packaged app at
      // launch with "Cannot find module …". Letting rollup inline them + all
      // their transitive deps makes the asar self-contained and sidesteps that
      // collector entirely. Both are pure JS (no native bindings), so bundling
      // is safe. (electron-vite 5 externalizes all deps by default — the
      // exclude list here is what keeps these two inlined.)
      externalizeDeps: { exclude: ['exceljs', '@mongosh/async-rewriter2'] },
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // Emitted as out/main/serializer.worker.js; loaded by serializerPool
          // via new Worker(join(__dirname, 'serializer.worker.js')).
          'serializer.worker': resolve(__dirname, 'src/main/workers/serializer.worker.ts')
        }
      }
    }
  },
  preload: {
    // build.externalizeDeps defaults to true in electron-vite 5 — no plugin needed
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
})
