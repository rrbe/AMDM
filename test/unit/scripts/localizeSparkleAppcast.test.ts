import { describe, expect, it } from "vitest";
import { localizeSparkleAppcast } from "../../../scripts/localize-sparkle-appcast.mjs";

const item = (version: string) =>
  `<item><sparkle:shortVersionString>${version}</sparkle:shortVersionString><description><![CDATA[English notes]]></description><sparkle:fullReleaseNotesLink>https://github.com/rrbe/AMDM/blob/master/CHANGELOG.md</sparkle:fullReleaseNotesLink><enclosure url="https://example.com/${version}.zip" sparkle:edSignature="signed"/><sparkle:deltas><enclosure url="https://example.com/${version}.delta" sparkle:edSignature="delta-signature"/></sparkle:deltas></item>`;

describe("localized Sparkle appcast", () => {
  it("replaces target notes and the history link while retaining all signed downloads", () => {
    const feed = `<channel>${item("1.1.0")}${item("1.0.0")}</channel>`;
    const result = localizeSparkleAppcast(feed, "1.1.0", "<p>中文说明 $&</p>");
    expect(result).toContain(
      "<description><![CDATA[<p>中文说明 $&</p>]]></description>",
    );
    expect(result.match(/English notes/g)).toHaveLength(1);
    expect(result.match(/<enclosure[^>]+\/>/g)).toEqual(
      feed.match(/<enclosure[^>]+\/>/g),
    );
    expect(result).not.toContain("/CHANGELOG.md");
    expect(result).toContain("/CHANGELOG_CN.md");
  });

  it("splits CDATA terminators without changing the release-note text", () => {
    expect(
      localizeSparkleAppcast(item("1.0.0"), "1.0.0", "<p>]]></p>"),
    ).toContain("<p>]]]]><![CDATA[></p>");
  });

  it("rejects a missing target or missing embedded description", () => {
    expect(() =>
      localizeSparkleAppcast(item("1.0.0"), "2.0.0", "notes"),
    ).toThrow("Missing appcast version");
    expect(() =>
      localizeSparkleAppcast(
        "<item><sparkle:shortVersionString>1.0.0</sparkle:shortVersionString></item>",
        "1.0.0",
        "notes",
      ),
    ).toThrow("Missing embedded release notes");
  });
});
