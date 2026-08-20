import { describe, expect, it } from 'vitest'
import { exportFileExtension, sanitizeExportBaseName } from '../../../src/shared/exportDestination'

describe('export destination', () => {
  it('derives the extension from the format and BSON compression option', () => {
    expect(exportFileExtension('csv')).toBe('csv')
    expect(exportFileExtension('xlsx')).toBe('xlsx')
    expect(exportFileExtension('bson')).toBe('bson')
    expect(exportFileExtension('bson', true)).toBe('bson.gz')
  })

  it('keeps a user-entered base name inside the selected directory', () => {
    expect(sanitizeExportBaseName('  sales/report:*  ')).toBe('sales-report--')
    expect(sanitizeExportBaseName('   ')).toBe('export')
  })
})
