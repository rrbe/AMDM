export function isSettingsWindowUrl(targetUrl: string, currentUrl: string): boolean {
  try {
    const target = new URL(targetUrl)
    const current = new URL(currentUrl)
    return (
      target.protocol === current.protocol &&
      target.host === current.host &&
      target.pathname === current.pathname &&
      target.hash === '#settings'
    )
  } catch {
    return false
  }
}
