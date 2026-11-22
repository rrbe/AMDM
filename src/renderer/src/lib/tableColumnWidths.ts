import { formatScalar, isExtended } from './ejson'
import { inlineText, toInlineJsonTokens } from './format'
import { plainScalarText } from './resultCopy'
import { cellValue, isPlainObject, type TableColumn } from './tableShape'

const SAMPLE_ROWS = 50
const SAMPLE_CELLS = 2_000
export const MAX_AUTO_WIDTH = 360

export function measureTableColumnWidths(
  columns: TableColumn[],
  docs: unknown[],
  fontSize: number,
  timeZone?: string
): Map<string, number> {
  const widths = new Map<string, number>()
  if (!columns.length) return widths

  const context = document.createElement('canvas').getContext('2d')!
  const style = getComputedStyle(document.documentElement)
  context.font = `500 ${style.getPropertyValue('--fs-sm')} ${style.getPropertyValue('--font-ui')}`
  for (const column of columns) {
    // The header reserves 28px padding, a 13px sort icon, a 6px gap and a 1px border.
    widths.set(column.id, Math.ceil(context.measureText(inlineText(column.label)).width) + 48)
  }

  context.font = `${fontSize}px ${style.getPropertyValue('--font-mono')}`
  const sampleSize = Math.min(docs.length, SAMPLE_ROWS, Math.max(1, Math.floor(SAMPLE_CELLS / columns.length)))
  const textWidths = new Map<string, number>()
  for (const column of columns) {
    const samples: number[] = []
    for (let row = 0; row < sampleSize; row++) {
      const { present, value } = cellValue(docs[row], column.path)
      if (!present) continue
      let text: string
      if (Array.isArray(value) || (isPlainObject(value) && !isExtended(value))) {
        text = toInlineJsonTokens(value, timeZone).map((token) => token.text).join('')
      } else {
        const scalar = formatScalar(value, timeZone)
        text = column.path[0] === '_id' && scalar.type === 'objectId' ? plainScalarText(value) : scalar.text
      }
      text = inlineText(text)
      let width = textWidths.get(text)
      if (width === undefined) {
        width = Math.ceil(context.measureText(text).width) + 21
        textWidths.set(text, width)
      }
      samples.push(width)
    }
    samples.sort((a, b) => a - b)
    const typicalWidth = samples[Math.ceil(samples.length * 0.9) - 1] ?? 0
    widths.set(column.id, Math.max(widths.get(column.id)!, typicalWidth))
  }
  return widths
}
