/** Decide whether a scheduled Sparkle result should become a visible reminder. */
export function scheduledReminderVersion(
  version: string,
  automaticallyChecksForUpdates: boolean,
  acknowledgedVersion: string | null
): string | null {
  if (!automaticallyChecksForUpdates || version === acknowledgedVersion) return null
  return version
}
