import { describe, expect, it } from 'vitest'
import { resourcePreview } from '@renderer/lib/resourcePreview'

describe('resource preview URLs', () => {
  it.each(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico'])('recognizes .%s image paths', (extension) => {
    const url = `https://images.example.com/photo.${extension}`
    expect(resourcePreview(url)).toEqual({ url, type: 'image' })
  })

  it('accepts HTTP, uppercase extensions, and signed query strings without losing them', () => {
    const url = 'http://images.example.com/photo.PNG?signature=abc%2Fdef&size=200#preview'
    expect(resourcePreview(url)).toEqual({ url, type: 'image' })
  })

  it.each([
    ['mp4', 'video'], ['webm', 'video'], ['mov', 'video'], ['ogv', 'video'], ['m3u8', 'video'],
    ['mp3', 'audio'], ['wav', 'audio'], ['ogg', 'audio'], ['m4a', 'audio']
  ])('recognizes .%s resources', (extension, type) => {
    const url = `https://cdn.example.com/resource.${extension}`
    expect(resourcePreview(url)).toEqual({ url, type })
  })

  it('disables previews for both absolute and CDN paths', () => {
    const settings = { previewResources: false, cdnPrefix: 'https://cdn.example.com' }
    expect(resourcePreview('https://example.com/image.jpg', settings)).toBeNull()
    expect(resourcePreview('/image.jpg', settings)).toBeNull()
  })

  it.each(['images/photo.jpg', '/images/photo.jpg'])('prepends the CDN directory to %s', (path) => {
    expect(resourcePreview(path, { cdnPrefix: 'https://cdn.example.com/assets/' })).toEqual({
      url: 'https://cdn.example.com/assets/images/photo.jpg', type: 'image'
    })
  })

  it.each([
    ['images/photo.png', 'image'], ['/videos/clip.mp4', 'video'],
    ['videos/stream.m3u8?token=a%2Fb', 'video'], ['/audio/clip.mp3', 'audio']
  ])('uses the connection preview settings for %s', (path, type) => {
    expect(resourcePreview(path, { previewResources: true, cdnPrefix: 'https://cdn.example.com/assets/' })).toEqual({
      url: `https://cdn.example.com/assets/${path.replace(/^\//, '')}`, type
    })
    expect(resourcePreview(path)).toBeNull()
    expect(resourcePreview(path, { cdnPrefix: '' })).toBeNull()
    expect(resourcePreview(path, { previewResources: false, cdnPrefix: 'https://cdn.example.com' })).toBeNull()
  })

  it('preserves full URLs and signed query strings with a CDN prefix', () => {
    const settings = { cdnPrefix: 'https://cdn.example.com/assets' }
    const url = 'https://other.example.com/video.MP4?token=a%2Fb#t=1'
    expect(resourcePreview(url, settings)).toEqual({ url, type: 'video' })
    expect(resourcePreview('video.mp4?token=a%2Fb', settings)).toEqual({
      url: 'https://cdn.example.com/assets/video.mp4?token=a%2Fb', type: 'video'
    })
  })

  it.each(['file:///tmp', 'https://user:secret@example.com', 'not a URL'])('rejects an unsafe or invalid CDN prefix %s', (cdnPrefix) => {
    expect(resourcePreview('photo.jpg', { cdnPrefix })).toBeNull()
  })

  it.each(['file:///photo.jpg', '//other.example.com/photo.jpg', 'javascript:photo.jpg', 'data:photo.jpg'])('does not turn %s into a CDN path', (value) => {
    expect(resourcePreview(value, { cdnPrefix: 'https://cdn.example.com' })).toBeNull()
  })

  it.each([
    null, 42, { $regex: 'https://example.com/a.png' },
    '/photo.png', '//example.com/photo.png', 'file:///photo.png',
    'data:image/png;base64,abc', 'javascript:alert(1)',
    'https://', 'https://example.com/photo.png/other',
    'https://example.com/page?file=photo.png', 'https://example.com/a.png.html',
    'https://user:secret@example.com/a.png', 'text https://example.com/a.png'
  ])('does not preview %j', (value) => {
    expect(resourcePreview(value)).toBeNull()
  })
})
