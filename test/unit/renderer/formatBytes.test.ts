import { describe, expect, it } from 'vitest'
import { formatBytes } from '../../../src/renderer/src/lib/formatBytes'

describe('formatBytes', () => {
  it('uses a readable binary unit', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(193_273_528)).toBe('184.32 MB')
  })
})
