export function localizeSparkleAppcast(appcast, version, notes) {
  let updated = false;
  const localized = appcast.replace(/<item>[\s\S]*?<\/item>/g, (item) => {
    if (
      !item.includes(
        `<sparkle:shortVersionString>${version}</sparkle:shortVersionString>`,
      )
    )
      return item;
    if (!/<description\b[^>]*>[\s\S]*?<\/description>/.test(item))
      throw new Error(`Missing embedded release notes for ${version}`);
    updated = true;
    return item.replace(
      /<description\b[^>]*>[\s\S]*?<\/description>/,
      () =>
        `<description><![CDATA[${notes.replaceAll("]]>", "]]]]><![CDATA[>")}]]></description>`,
    );
  });
  if (!updated) throw new Error(`Missing appcast version: ${version}`);
  return localized.replaceAll(
    "/blob/master/CHANGELOG.md",
    "/blob/master/CHANGELOG_CN.md",
  );
}
