import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

export default function configureSparkleFeed(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appName = readdirSync(context.appOutDir).find((name) =>
    name.endsWith(".app"),
  );
  if (!appName)
    throw new Error(`macOS app bundle not found in ${context.appOutDir}`);

  const arch = { 1: "x64", 3: "arm64" }[context.arch];
  if (!arch) throw new Error(`Unsupported macOS architecture: ${context.arch}`);
  const infoPlist = join(
    context.appOutDir,
    appName,
    "Contents",
    "Info.plist",
  );

  execFileSync(
    "plutil",
    [
      "-replace",
      "SUFeedURL",
      "-string",
      `https://github.com/rrbe/AMDM/releases/latest/download/appcast-${arch}.xml`,
      infoPlist,
    ],
    { stdio: "inherit" },
  );
}
