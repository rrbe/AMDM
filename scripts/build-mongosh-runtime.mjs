import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const outputDirectory = resolve("out/main");
const common = {
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
};

await mkdir(outputDirectory, { recursive: true });
await build({
  ...common,
  entryPoints: [resolve("src/main/mongo/mongoshVendor.ts")],
  outfile: resolve(outputDirectory, "mongosh-runtime.cjs"),
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
