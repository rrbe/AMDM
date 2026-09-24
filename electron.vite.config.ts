import { resolve } from 'path'
import { execFileSync } from 'node:child_process'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { version } from './package.json'
import { mongoshEditorPlugin } from './scripts/mongosh-editor-types.mjs'

const mongoshRuntimePlugin = {
  name: 'build-mongosh-runtime',
  closeBundle(): void {
    execFileSync(process.execPath, [resolve('scripts/build-mongosh-runtime.mjs')], { stdio: 'inherit' })
  }
}

export default defineConfig({
  main: {
    // electron-vite clears out/main before both production and dev builds.
    // Build the isolated mongosh artifact only after the main bundle has been
    // written so Electron never starts with the companion file missing.
    plugins: [mongoshRuntimePlugin],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      // exceljs, the Schema analyzer, the MongoDB driver and its
      // connection-string parser are bundled (not externalized) on purpose:
      // electron-builder 26's pnpm
      // dependency collector reconstructs
      // the nested tree from the lockfile and drops some leaf transitive deps —
      // util-deprecate under exceljs's readable-stream, for example. Externalizing
      // those dependencies caused "Cannot find module …" at launch. Inlining
      // their transitive deps makes the asar self-contained and sidesteps that
      // collector entirely. All are pure JS (no native bindings), so bundling
      // is safe. (electron-vite 5 externalizes all deps by default — the
      // exclude list here is what keeps them inlined.)
      externalizeDeps: {
        exclude: [
          'exceljs',
          '@mongodb-js/mongodb-schema',
          'reservoir',
          'mongodb',
          'mongodb-connection-string-url'
        ]
      },
      rollupOptions: {
        // These optional Driver integrations are present only because the
        // official mongosh provider uses them. Keep the existing main bundle
        // from traversing that dependency graph; the Stage-0 runtime is built
        // separately by scripts/build-mongosh-runtime.mjs.
        external: [
          '@aws-sdk/credential-providers',
          'gcp-metadata',
          'kerberos',
          'mongodb-client-encryption'
        ],
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
    define: {
      __APP_VERSION__: JSON.stringify(version)
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
        // shadcn convention: '@' points at the renderer source root, mirrored
        // in tsconfig.web.json#paths so generated components resolve '@/...'.
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss(), mongoshEditorPlugin()],
    worker: { plugins: () => [mongoshEditorPlugin()] },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
})
