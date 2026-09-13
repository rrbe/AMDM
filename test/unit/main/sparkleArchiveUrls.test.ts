import { describe, expect, it } from "vitest";
import { restoreArchiveReleaseUrls } from "../../../scripts/sparkle-archive-urls.mjs";

describe("Sparkle archive release URLs", () => {
  it.each(["arm64", "x64"])(
    "restores historical %s ZIP releases while preserving signatures and delta URLs",
    (arch) => {
      const prefix = "https://github.com/rrbe/AMDM/releases/download/";
      const feed = `<item>
      <enclosure url="${prefix}v26.9.2/AMDM-26.8.17-${arch}-mac.zip" sparkle:edSignature="signature"/>
      <enclosure url="${prefix}v26.9.2/AMDM26.9.2-26.8.17-${arch}.delta"/>
    </item>`;
      const corrected = restoreArchiveReleaseUrls(feed);
      expect(corrected).toBe(
        feed.replace(
          `v26.9.2/AMDM-26.8.17-${arch}-mac.zip`,
          `v26.8.17/AMDM-26.8.17-${arch}-mac.zip`,
        ),
      );
      expect(restoreArchiveReleaseUrls(corrected)).toBe(corrected);
    },
  );

  it("retains prerelease versions and leaves current ZIP URLs unchanged", () => {
    const url =
      "https://github.com/rrbe/AMDM/releases/download/v26.9.2-beta.1/AMDM-26.9.2-beta.1-arm64-mac.zip";
    const feed = `<enclosure url="${url}"/>`;
    expect(restoreArchiveReleaseUrls(feed)).toBe(feed);
  });
});
