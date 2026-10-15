import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const outputDirectory = resolve(process.argv[2] ?? "out/main");
const common = {
  bundle: true,
  format: "esm",
  // Official mongosh packages use dynamic require() for Node built-ins.
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
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
};

await mkdir(outputDirectory, { recursive: true });
await build({
  ...common,
  entryPoints: [resolve("src/main/mongo/mongoshVendor.ts")],
  outfile: resolve(outputDirectory, "mongosh-runtime.mjs"),
  plugins: [
    {
      name: "exclude-unreachable-mongosh-connect",
      setup(build) {
        build.onResolve({ filter: /^@mongodb-js\/devtools-connect$/ }, () => ({
          path: "mongosh-connect-shim",
          namespace: "amdm",
        }));
        build.onLoad({ filter: /.*/, namespace: "amdm" }, () => ({
          contents:
            'exports.connectMongoClient = async () => { throw new Error("Explicit new Mongo connections are not supported by AMDM"); };',
          loader: "js",
        }));
      },
    },
  ],
});
