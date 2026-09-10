import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const outputDirectory = resolve("out/main");

await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: [resolve("src/main/mongo/mongoshVendor.ts")],
  outfile: resolve(outputDirectory, "mongosh-runtime.cjs"),
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node22",
  minify: true,
  sourcemap: false,
  external: [
    "electron",
    "kerberos",
    "mongodb-client-encryption",
    "@mongodb-js/zstd",
    "snappy",
    "gcp-metadata",
    "bindings",
    "cpu-features",
    "pac-proxy-agent",
    "@babel/preset-typescript/package.json",
  ],
  logLevel: "info",
});
