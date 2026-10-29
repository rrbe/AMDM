import { describe, expect, it } from 'vitest'
import { imagePreviewUrl } from '@renderer/lib/imagePreview'

describe('image preview URLs', () => {
  it.each(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico'])('recognizes .%s image paths', (extension) => {
    const url = `https://images.example.com/photo.${extension}`
    expect(imagePreviewUrl(url)).toBe(url)
  })

  it('accepts HTTP, uppercase extensions, and signed query strings without losing them', () => {
    const url = 'http://images.example.com/photo.PNG?signature=abc%2Fdef&size=200#preview'
    expect(imagePreviewUrl(url)).toBe(url)
  })

  it.each([
    null, 42, { $regex: 'https://example.com/a.png' },
    '/photo.png', '//example.com/photo.png', 'file:///photo.png',
    'data:image/png;base64,abc', 'javascript:alert(1)',
    'https://', 'https://example.com/photo.png/other',
    'https://example.com/page?file=photo.png', 'https://example.com/a.png.html',
    'https://user:secret@example.com/a.png', 'text https://example.com/a.png'
  ])('does not preview %j', (value) => {
    expect(imagePreviewUrl(value)).toBeNull()
  })
})
