import { describe, expect, it } from 'vitest'
import { tabularExportDefaults } from '@renderer/lib/exportDefaults'

describe('tabularExportDefaults', () => {
  it.each(['MacIntel', 'macOS', 'Darwin', 'Linux x86_64'])('uses Unix-style defaults on %s', (platform) => {
    expect(tabularExportDefaults(platform)).toEqual({
      utf8Bom: false,
      lineEnding: 'lf'
    })
  })

  it.each(['Win32', 'Windows'])('uses spreadsheet-friendly defaults on %s', (platform) => {
    expect(tabularExportDefaults(platform)).toEqual({
      utf8Bom: true,
      lineEnding: 'crlf'
    })
  })
})
