import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import pkg from "./package.json" with { type: "json" };
import { mongoshEditorPlugin } from "./scripts/mongosh-editor-types.mjs";

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
  plugins: [react(), tailwindcss(), mongoshEditorPlugin()],
  worker: { plugins: () => [mongoshEditorPlugin()] },
  build: {
    outDir: resolve("out/web"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve("src/renderer/index.html"),
    },
  },
});
