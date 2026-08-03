import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  throw new Error("Sparkle appcasts must be generated on macOS");
}

const privateKey = process.env.SPARKLE_PRIVATE_ED_KEY?.trim();
if (!privateKey)
  throw new Error("SPARKLE_PRIVATE_ED_KEY is required to sign the appcast");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(process.argv[2] ?? join(root, "dist"));
const sparkleDir = join(root, "build", "sparkle");
const generateAppcast = join(sparkleDir, "bin", "generate_appcast");
const feedUrl =
  process.env.SPARKLE_APPCAST_URL ??
  "https://github.com/rrbe/AMDM/releases/latest/download/appcast.xml";
const releaseTag = process.env.GITHUB_REF_NAME;
const downloadUrlPrefix = (
  process.env.SPARKLE_DOWNLOAD_URL_PREFIX ??
  (releaseTag
    ? `https://github.com/rrbe/AMDM/releases/download/${encodeURIComponent(releaseTag)}/`
    : "")
).replace(/\/?$/, "/");

if (!existsSync(generateAppcast)) {
  throw new Error("Sparkle tools are missing; run pnpm prepare:sparkle first");
}
if (!downloadUrlPrefix)
  throw new Error("SPARKLE_DOWNLOAD_URL_PREFIX is required");

const archives = readdirSync(distDir).filter((name) => name.endsWith(".zip"));
if (archives.length === 0)
  throw new Error(`No macOS zip archives found in ${distDir}`);

const workDir = join(tmpdir(), `amdm-appcast-${Date.now()}`);
mkdirSync(workDir, { recursive: true });

try {
  for (const archive of archives) {
    const source = join(distDir, archive);
    const target = join(workDir, archive);
    try {
      linkSync(source, target);
    } catch {
      copyFileSync(source, target);
    }
  }

  const previousAppcast = join(workDir, "appcast.xml");
  try {
    execFileSync("curl", ["-fsSL", feedUrl, "-o", previousAppcast], {
      stdio: "ignore",
    });
  } catch {
    // The first release has no previous appcast.
  }

  const result = spawnSync(
    generateAppcast,
    [
      "--ed-key-file",
      "-",
      "--download-url-prefix",
      downloadUrlPrefix,
      "--link",
      "https://github.com/rrbe/AMDM/releases",
      "-o",
      previousAppcast,
      workDir,
    ],
    {
      input: `${privateKey}\n`,
      encoding: "utf8",
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`generate_appcast exited with ${result.status}`);

  const appcast = readFileSync(previousAppcast, "utf8");
  const enclosureCount = appcast.match(/<enclosure\b/g)?.length ?? 0;
  const signatureCount = appcast.match(/sparkle:edSignature=/g)?.length ?? 0;
  if (enclosureCount === 0 || signatureCount < enclosureCount) {
    throw new Error(
      "Generated appcast contains unsigned updates; verify SPARKLE_PRIVATE_ED_KEY matches SPARKLE_PUBLIC_ED_KEY",
    );
  }

  for (const file of readdirSync(workDir)) {
    if (file.endsWith(".xml") || file.endsWith(".delta")) {
      copyFileSync(join(workDir, file), join(distDir, file));
    }
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

console.log(`Generated Sparkle appcast in ${distDir}`);
