import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // exceljs is bundled (not externalized) on purpose: electron-builder 26's
    // pnpm dependency collector reconstructs the nested tree from the lockfile
    // and drops some leaf transitive deps (e.g. util-deprecate under
    // readable-stream → archiver/unzipper), so an externalized exceljs crashed
    // the packaged app at launch with "Cannot find module 'util-deprecate'".
    // Letting rollup inline exceljs + all its transitive deps makes the asar
    // self-contained and sidesteps that collector entirely. exceljs is pure JS
    // (no native bindings), so bundling is safe.
    plugins: [externalizeDepsPlugin({ exclude: ['exceljs'] })],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
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
    plugins: [externalizeDepsPlugin()],
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
