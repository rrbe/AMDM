import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  groupCommits,
  releaseHistory,
  renderChangelog,
  renderSparkleNotes,
} from "../../../scripts/generate-release-notes.mjs";

const directories: string[] = [];
afterEach(() =>
  directories
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true })),
);

function repository() {
  const cwd = mkdtempSync(join(tmpdir(), "amdm-notes-test-"));
  directories.push(cwd);
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-b", "master");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  const commit = (subject: string, tag?: string) => {
    git("commit", "--allow-empty", "-m", subject);
    if (tag) git("tag", tag);
  };
  return { cwd, git, commit };
}
const published = (...tags: string[]) =>
  tags.map((tag_name) => ({ tag_name, draft: false }));

describe("commit-based release notes", () => {
  it("classifies commits, preserves scope and breaking changes, and excludes release bookkeeping", () => {
    expect(
      groupCommits([
        "feat(table): nested preview",
        "fix!: remove unsafe write",
        "perf: stream results",
        "update TODO",
        "chore: bump version to 26.9.1",
        "chore: release 26.8.8",
        "chore: bump version to 26.9.2-beta.1",
        "docs: update changelog for v26.9.2-beta.1",
        "docs: update changelog for v26.9.1",
      ]),
    ).toEqual([
      ["新功能", ["table: nested preview"]],
      ["修复", ["Breaking: remove unsafe write"]],
      ["性能优化", ["stream results"]],
      ["其他更新", ["update TODO"]],
    ]);
  });

  it("uses published boundaries, includes PR commits once, and excludes commits after the release tag", () => {
    const { cwd, git, commit } = repository();
    commit("feat: initial", "v1.0.0");
    git("checkout", "-b", "feature");
    commit("feat: PR feature");
    git("checkout", "master");
    git("merge", "--no-ff", "feature", "-m", "Merge pull request #1");
    commit("fix: failed release change", "v1.0.1");
    commit("fix: current release", "v1.0.2");
    commit("feat: next release");
    const releases = [
      ...published("v1.0.0"),
      { tag_name: "v1.0.1", draft: true },
    ];
    const history = releaseHistory({ cwd, releases, tag: "v1.0.2" });
    expect(history.map((release) => release.tag)).toEqual(["v1.0.2", "v1.0.0"]);
    expect(history[0].groups).toEqual([
      ["新功能", ["PR feature"]],
      ["修复", ["current release", "failed release change"]],
    ]);
    const rerun = releaseHistory({
      cwd,
      releases: [...releases, ...published("v1.0.2")],
      tag: "v1.0.2",
    });
    expect(renderChangelog(rerun)).toBe(renderChangelog(history));
    expect(renderChangelog(history)).not.toContain("next release");
    expect(history[1].groups).toEqual([["新功能", ["initial"]]]);
  });

  it("includes prerelease changes in the next stable release", () => {
    const { cwd, commit } = repository();
    commit("feat: initial", "v1.0.0");
    commit("feat: beta feature", "v1.1.0-beta.1");
    commit("fix: stable fix", "v1.1.0");
    const history = releaseHistory({
      cwd,
      releases: published("v1.0.0", "v1.1.0-beta.1"),
      tag: "v1.1.0",
    });
    expect(history[0].groups).toEqual([
      ["新功能", ["beta feature"]],
      ["修复", ["stable fix"]],
    ]);
    expect(renderSparkleNotes(history, "v1.1.0")).not.toContain(
      "<h2>v1.1.0-beta.1",
    );
  });

  it("shows at most three versions starting with the requested version and escapes commit HTML", () => {
    const history = ["v1.4.0", "v1.3.0", "v1.2.0", "v1.1.0", "v1.0.0"].map(
      (tag) => ({
        tag,
        date: "2026-09-13",
        groups: [["新功能", ['<script>alert("x")</script> & ]]>']]],
      }),
    );
    const html = renderSparkleNotes(history, "v1.3.0");
    expect(html.match(/<section>/g)).toHaveLength(3);
    expect(html).toContain("<h2>v1.3.0");
    expect(html).not.toContain("v1.4.0");
    expect(html).not.toContain("v1.0.0");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("]]>");
    expect(html).toContain("&lt;script&gt;");
    expect(
      renderSparkleNotes(history, "v1.0.0").match(/<section>/g),
    ).toHaveLength(1);
  });

  it("rejects missing published tags instead of silently losing release history", () => {
    const { cwd, commit } = repository();
    commit("feat: initial", "v1.0.0");
    expect(() =>
      releaseHistory({ cwd, releases: published("v1.0.1") }),
    ).toThrow();
  });
});
