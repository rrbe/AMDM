import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

export default function writeSparklePublicKey(context) {
  if (context.electronPlatformName !== "darwin") return;

  const publicKey = process.env.SPARKLE_PUBLIC_ED_KEY?.trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(publicKey ?? "")) {
    throw new Error(
      "SPARKLE_PUBLIC_ED_KEY must be a 32-byte base64 EdDSA public key",
    );
  }

  const appName = readdirSync(context.appOutDir).find((name) =>
    name.endsWith(".app"),
  );
  if (!appName)
    throw new Error(`macOS app bundle not found in ${context.appOutDir}`);

  execFileSync(
    "plutil",
    [
      "-replace",
      "SUPublicEDKey",
      "-string",
      publicKey,
      join(context.appOutDir, appName, "Contents", "Info.plist"),
    ],
    { stdio: "inherit" },
  );
}
