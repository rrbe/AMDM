import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") process.exit(0);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = "2.9.2";
const archiveSha256 =
  "1cb340cbbef04c6c0d162078610c25e2221031d794a3449d89f2f56f4df77c95";
const sparkleDir = join(root, "build", "sparkle");
const frameworkPath = join(sparkleDir, "Sparkle.framework");
const appcastTool = join(sparkleDir, "bin", "generate_appcast");
const addonPath = join(sparkleDir, "native", "sparkle.node");
const versionPath = join(sparkleDir, ".version");

let installedVersion = "";
try {
  installedVersion = readFileSync(versionPath, "utf8").trim();
} catch {
  // Download below.
}

if (
  installedVersion !== version ||
  !existsSync(frameworkPath) ||
  !existsSync(appcastTool)
) {
  const archivePath = join(tmpdir(), `amdm-sparkle-${version}.tar.xz`);
  const archiveUrl = `https://github.com/sparkle-project/Sparkle/releases/download/${version}/Sparkle-${version}.tar.xz`;
  execFileSync("curl", ["-fL", "--retry", "3", "-o", archivePath, archiveUrl], {
    stdio: "inherit",
  });
  const actualSha256 = createHash("sha256")
    .update(readFileSync(archivePath))
    .digest("hex");
  if (actualSha256 !== archiveSha256) {
    rmSync(archivePath, { force: true });
    throw new Error(
      `Sparkle ${version} archive SHA-256 mismatch: expected ${archiveSha256}, got ${actualSha256}`,
    );
  }

  rmSync(sparkleDir, { recursive: true, force: true });
  mkdirSync(sparkleDir, { recursive: true });
  execFileSync("tar", ["-xJf", archivePath, "-C", sparkleDir], {
    stdio: "inherit",
  });
  writeFileSync(versionPath, `${version}\n`);
}

mkdirSync(dirname(addonPath), { recursive: true });
execFileSync(
  "clang++",
  [
    "-std=c++17",
    "-fobjc-arc",
    "-DBUILDING_NODE_EXTENSION",
    "-DNODE_GYP_MODULE_NAME=sparkle",
    "-arch",
    "arm64",
    "-arch",
    "x86_64",
    "-mmacosx-version-min=10.13",
    "-I",
    join(root, "node_modules", "node-addon-api", "external-napi"),
    "-F",
    sparkleDir,
    "-bundle",
    "-undefined",
    "dynamic_lookup",
    "-Wl,-rpath,@loader_path/../../Frameworks",
    "-framework",
    "Sparkle",
    "-framework",
    "Cocoa",
    join(root, "native", "sparkle.mm"),
    "-o",
    addonPath,
  ],
  { cwd: root, stdio: "inherit" },
);

console.log(`Prepared Sparkle ${version}`);
