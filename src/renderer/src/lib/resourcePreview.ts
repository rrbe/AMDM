import type { ConnectionConfig } from '@shared/types'

export type ResourcePreviewSettings = Pick<ConnectionConfig, 'previewResources' | 'cdnPrefix'>
export interface PreviewResource {
  url: string
  type: 'image' | 'video' | 'audio'
}

export function resourcePreview(value: unknown, settings?: ResourcePreviewSettings): PreviewResource | null {
  if (settings?.previewResources === false || typeof value !== 'string' || !value.trim()) return null
  let source = value
  if (!/^https?:\/\//i.test(source)) {
    if (!settings?.cdnPrefix || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(source)) return null
    source = `${settings.cdnPrefix.replace(/\/+$/, '')}/${source.replace(/^\/+/, '')}`
  }
  try {
    const url = new URL(source)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    const type = /\.(?:jpe?g|png|gif|webp|avif|bmp|svg|ico)$/i.test(url.pathname) ? 'image'
      : /\.(?:mp4|webm|mov|m4v|ogv)$/i.test(url.pathname) ? 'video'
      : /\.(?:mp3|wav|ogg|m4a|aac|flac)$/i.test(url.pathname) ? 'audio' : null
    return type ? { url: url.href, type } : null
  } catch {
    return null
  }
}
