import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const repositoryUrl = "https://github.com/rrbe/AMDM";
const tagPattern = /^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/;
const translations = JSON.parse(
  readFileSync(
    new URL("../docs/release-notes/translations.json", import.meta.url),
    "utf8",
  ),
);
const labels = {
  en: {
    categories: {
      新功能: "Features",
      修复: "Fixes",
      性能优化: "Performance",
      其他更新: "Other Updates",
    },
    empty: "No additional updates.",
    title: "Changelog",
    file: "CHANGELOG.md",
    full: "Full changelog",
    other: "[中文](CHANGELOG_CN.md)",
  },
  zh: {
    categories: {
      新功能: "新功能",
      修复: "修复",
      性能优化: "性能优化",
      其他更新: "其他更新",
    },
    empty: "无额外更新条目。",
    title: "更新日志",
    file: "CHANGELOG_CN.md",
    full: "完整更新记录",
    other: "[English](CHANGELOG.md)",
  },
};

export function localizeHistory(history, language, catalog = translations) {
  return history.map((release) => ({
    ...release,
    groups: release.groups.map(([category, entries]) => [
      labels[language].categories[category],
      entries.map((entry) => {
        const text = catalog[entry]?.[language];
        if (typeof text !== "string" || !text.trim())
          throw new Error(
            `Missing ${language} release-note translation: ${entry}`,
          );
        return text;
      }),
    ]),
  }));
}

const categories = ["新功能", "修复", "性能优化", "其他更新"];
const categoryByType = { feat: "新功能", fix: "修复", perf: "性能优化" };

export function groupCommits(subjects) {
  const groups = Object.fromEntries(
    categories.map((category) => [category, []]),
  );
  for (const subject of subjects) {
    if (
      /^(?:chore(?:\(release\))?: (?:bump version to|release) v?\d+\.\d+\.\d+(?:-[\w.-]+)?|docs: update changelog for v\d+\.\d+\.\d+(?:-[\w.-]+)?)$/.test(
        subject,
      )
    )
      continue;
    const match = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/.exec(subject);
    const category = categoryByType[match?.[1]] ?? "其他更新";
    const summary = match
      ? `${match[2] ? `${match[2]}: ` : ""}${match[3] ? "Breaking: " : ""}${match[4]}`
      : subject;
    groups[category].push(summary);
  }
  return Object.entries(groups).filter(([, entries]) => entries.length);
}

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

// Published releases define the boundaries; tags alone may represent failed builds.
export function releaseHistory({ cwd, releases, tag }) {
  if (tag && !tagPattern.test(tag))
    throw new Error(`Invalid release tag: ${tag}`);
  const published = releases.filter(
    (release) => !release.draft && tagPattern.test(release.tag_name),
  );
  const tags = new Set(published.map((release) => release.tag_name));
  if (tag) tags.add(tag);
  for (const name of tags)
    git(cwd, "rev-parse", "--verify", `refs/tags/${name}^{commit}`);
  const ordered = git(
    cwd,
    "-c",
    "versionsort.suffix=-",
    "tag",
    "--sort=-version:refname",
  )
    .split("\n")
    .filter((name) => tags.has(name));
  const isAncestor = (older, newer) => {
    try {
      git(
        cwd,
        "merge-base",
        "--is-ancestor",
        `refs/tags/${older}`,
        `refs/tags/${newer}`,
      );
      return true;
    } catch (error) {
      if (error.status === 1) return false;
      throw error;
    }
  };
  return ordered.map((name, index) => {
    // A stable release includes changes already shipped in a prerelease.
    const previous = ordered
      .slice(index + 1)
      .find(
        (candidate) =>
          (name.includes("-") || !candidate.includes("-")) &&
          isAncestor(candidate, name),
      );
    const range = previous
      ? `refs/tags/${previous}..refs/tags/${name}`
      : `refs/tags/${name}`;
    const subjects = git(cwd, "log", "--no-merges", "--format=%s", range)
      .split("\n")
      .filter(Boolean);
    return {
      tag: name,
      date: git(cwd, "log", "-1", "--format=%cs", `refs/tags/${name}`),
      groups: groupCommits(subjects),
    };
  });
}

const escapeHtml = (value) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
const escapeMarkdown = (value) =>
  escapeHtml(value).replace(/[\\`*_[\]{}()#+.!|~-]/g, "\\$&");

export function renderMarkdown(release, language = "en") {
  const groups = release.groups
    .map(
      ([category, entries]) =>
        `### ${category}\n\n${entries.map((entry) => `- ${escapeMarkdown(entry)}`).join("\n")}`,
    )
    .join("\n\n");
  return `## [${release.tag}](${repositoryUrl}/releases/tag/${release.tag}) — ${release.date}\n\n${groups || labels[language].empty}`;
}

export function renderChangelog(history, language = "en") {
  const locale = labels[language];
  return `# ${locale.title}\n\n${locale.other}\n\n<!-- Generated from published release tags and translated commit entries. Dates follow the tagged commits. -->\n\n${history.map((release) => renderMarkdown(release, language)).join("\n\n")}\n`;
}

export function renderSparkleNotes(history, tag, language = "en") {
  const index = history.findIndex((release) => release.tag === tag);
  if (index < 0) throw new Error(`Missing release: ${tag}`);
  const recent = history
    .slice(index)
    .filter((release) => tag.includes("-") || !release.tag.includes("-"))
    .slice(0, 3);
  // An HTML fragment is embedded by generate_appcast, without a separate download.
  return (
    recent
      .map(
        (release) =>
          `<section><h2>${escapeHtml(release.tag)} — ${release.date}</h2>${
            release.groups
              .map(
                ([category, entries]) =>
                  `<h3>${category}</h3><ul>${entries.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul>`,
              )
              .join("") || `<p>${labels[language].empty}</p>`
          }</section>`,
      )
      .join("\n") +
    `\n<p><a href="${repositoryUrl}/blob/master/${labels[language].file}">${labels[language].full}</a></p>\n`
  );
}

const macInstructions = `## macOS 首次打开

本应用使用 ad-hoc 签名且未经 Apple 公证，从网络下载后可能被 Gatekeeper 拦截。任选一种方式放行：

**方式 A：** 尝试打开一次后，前往“系统设置 → 隐私与安全性”，找到 AMDM 的拦截提示并点击“仍要打开”。

**方式 B：** 将 AMDM 拖入“应用程序”后，在终端执行：

\`\`\`bash
xattr -dr com.apple.quarantine /Applications/AMDM.app
\`\`\`
`;

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { values } = parseArgs({
    options: {
      releases: { type: "string" },
      tag: { type: "string" },
      output: { type: "string" },
      changelog: { type: "string" },
      "changelog-cn": { type: "string" },
    },
  });
  if (!values.releases)
    throw new Error("--releases is required (GitHub releases API JSON array)");
  const releases = JSON.parse(readFileSync(values.releases, "utf8")).flat();
  const history = releaseHistory({
    cwd: process.cwd(),
    releases,
    tag: values.tag,
  });
  const english = localizeHistory(history, "en");
  const chinese = localizeHistory(history, "zh");
  if (values.changelog)
    writeFileSync(values.changelog, renderChangelog(english, "en"));
  if (values["changelog-cn"])
    writeFileSync(values["changelog-cn"], renderChangelog(chinese, "zh"));
  if (values.output) {
    if (!values.tag) throw new Error("--tag is required with --output");
    mkdirSync(values.output, { recursive: true });
    writeFileSync(
      join(values.output, "release-notes.md"),
      `${renderMarkdown(
        chinese.find((release) => release.tag === values.tag),
        "zh",
      )}\n\n${macInstructions}`,
    );
    writeFileSync(
      join(values.output, "sparkle-notes.html"),
      renderSparkleNotes(english, values.tag, "en"),
    );
    writeFileSync(
      join(values.output, "sparkle-notes-cn.html"),
      renderSparkleNotes(chinese, values.tag, "zh"),
    );
  }
}
