export function matchesSettingsSearch(keywords: readonly string[], query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase()
  return !normalized || keywords.some((keyword) => keyword.toLocaleLowerCase().includes(normalized))
}
