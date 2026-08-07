const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

export function formatBytes(bytes: number): string {
  const unit = Math.min(Math.floor(Math.log2(Math.max(bytes, 1)) / 10), UNITS.length - 1)
  return `${(bytes / 1024 ** unit).toFixed(unit === 0 ? 0 : 2)} ${UNITS[unit]}`
}
