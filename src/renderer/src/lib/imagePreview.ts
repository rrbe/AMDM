export function imagePreviewUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return null
  try {
    const url = new URL(value)
    if (url.username || url.password || !/\.(?:jpe?g|png|gif|webp|avif|bmp|svg|ico)$/i.test(url.pathname)) return null
    return url.href
  } catch {
    return null
  }
}
