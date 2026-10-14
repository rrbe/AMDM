import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve("src/shared"),
    },
  },
  build: {
    ssr: true,
    target: "node22",
    outDir: resolve("out/web-server"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve("src/web/index.ts"),
        "serializer.worker": resolve("src/main/workers/serializer.worker.ts"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "index" ? "index.mjs" : "[name].js",
        format: "es",
      },
    },
  },
});
