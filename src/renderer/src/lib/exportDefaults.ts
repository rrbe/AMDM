export interface TabularExportDefaults {
  utf8Bom: boolean
  lineEnding: 'lf' | 'crlf'
}

/** Match CSV/TSV defaults to the conventions of the current desktop OS. */
export function tabularExportDefaults(platform = navigator.platform): TabularExportDefaults {
  const isWindows = platform.toLowerCase().startsWith('win')
  return {
    utf8Bom: isWindows,
    lineEnding: isWindows ? 'crlf' : 'lf'
  }
}
