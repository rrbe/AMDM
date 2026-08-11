import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared')
    }
  },
  ssr: {
    noExternal: ['@mongosh/async-rewriter2']
  },
  build: {
    ssr: resolve('src/web/index.ts'),
    target: 'node22',
    outDir: resolve('out/web-server'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'index.mjs',
        format: 'es'
      }
    }
  }
})
