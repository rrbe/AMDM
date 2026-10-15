import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import pkg from "./package.json" with { type: "json" };
import { mongoshEditorPlugin } from "./scripts/mongosh-editor-types.mjs";

const compressBrotli = promisify(brotliCompress);
const compressGzip = promisify(gzip);

export default defineConfig({
  root: "src/renderer",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __WEB__: "true",
  },
  resolve: {
    alias: {
      "@renderer": resolve("src/renderer/src"),
      "@shared": resolve("src/shared"),
      "@": resolve("src/renderer/src"),
    },
  },
  plugins: [
    react(), tailwindcss(), mongoshEditorPlugin(),
    {
      name: "precompress-web-assets",
      async writeBundle(options, bundle) {
        for (const file of Object.values(bundle)) {
          if (!/\.(?:js|css|html|json|svg)$/.test(file.fileName)) continue;
          const source = Buffer.from(file.type === "chunk" ? file.code : file.source);
          if (source.length < 1024) continue;
          const compressed = await Promise.all([
            compressBrotli(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }),
            compressGzip(source, { level: 9 }),
          ]);
          for (const [index, suffix] of ["br", "gz"].entries()) {
            if (compressed[index].length < source.length)
              await writeFile(resolve(options.dir!, `${file.fileName}.${suffix}`), compressed[index]);
          }
        }
      },
    },
  ],
  worker: { format: "es", plugins: () => [mongoshEditorPlugin()] },
  build: {
    outDir: resolve("out/web"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve("src/renderer/index.html"),
    },
  },
});
