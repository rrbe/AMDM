import type { CollectionSort } from '@shared/types'
import { isExtended, orderFieldNames } from './ejson'
import { isPlainObject } from './tableShape'

export const GRID_GAP = 12
export const GRID_FIELD_LIMIT = 8

export function gridColumnCount(width: number): number {
  return Math.max(1, Math.floor((width - GRID_GAP) / (340 + GRID_GAP)))
}

export function gridFields(
  value: unknown,
  visibleFields: readonly string[] | null,
  sort: CollectionSort,
  idFirst: boolean
): string[] | null {
  if (!isPlainObject(value) || isExtended(value)) return null
  const selected = visibleFields === null ? null : new Set(visibleFields)
  const keys = Object.keys(value).filter((key) => selected === null || selected.has(key))
  return orderFieldNames(keys, sort, idFirst)
}

export async function gridDocumentFieldCounts(
  docs: readonly unknown[],
  visibleFields: readonly string[] | null,
  signal: AbortSignal
): Promise<number[] | undefined> {
  const selected = visibleFields === null ? null : new Set(visibleFields)
  const counts: number[] = []
  let deadline = performance.now() + 6
  for (const doc of docs) {
    if (signal.aborted) return
    if (!isPlainObject(doc) || isExtended(doc)) counts.push(1)
    else if (selected) {
      let count = 0
      for (const key of selected) if (Object.hasOwn(doc, key)) count++
      counts.push(count)
    } else counts.push(Object.keys(doc).length)

    if (performance.now() >= deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      deadline = performance.now() + 6
    }
  }
  return counts
}

export function gridRowFieldCounts(documentCounts: readonly number[], columns: number): number[] {
  const rows: number[] = []
  documentCounts.forEach((count, index) => {
    const row = Math.floor(index / columns)
    rows[row] = Math.max(rows[row] ?? 1, count)
  })
  return rows
}

export function gridRows(docCount: number, columns: number, fontSize: number, fieldCounts?: readonly number[]) {
  let start = GRID_GAP
  return Array.from({ length: Math.ceil(docCount / columns) }, (_, index) => {
    const size = (fieldCounts?.[index] ?? GRID_FIELD_LIMIT) * (fontSize + 11) + 76 + GRID_GAP
    const row = { start, size }
    start += size
    return row
  })
}

// Keep the native scrollbar below Chromium's layout limit. Rows and fields use logical pixels.
export function gridScrollGeometry(total: number, viewport: number) {
  const height = Math.min(total, 8_000_000)
  const scale = total > height && height > viewport ? (total - viewport) / (height - viewport) : 1
  return { height, scale }
}

export function gridAnchorOffset(
  rows: readonly { start: number; size: number }[],
  rowIndex: number,
  offset: number
): number {
  const row = rows[Math.min(rowIndex, rows.length - 1)]
  if (!row) return 0
  return Math.max(0, row.start + (offset < row.size - GRID_GAP ? offset : 0))
}

export function gridVisibleFieldIndexes(
  count: number,
  fieldTop: number,
  scrollTop: number,
  viewportHeight: number,
  lineHeight: number,
  focusedIndex: number | null
): number[] {
  const start = Math.min(count, Math.max(0, Math.floor((scrollTop - fieldTop) / lineHeight) - 2))
  const end = Math.min(count, Math.max(start, Math.ceil((scrollTop + viewportHeight - fieldTop) / lineHeight) + 2))
  const indexes = Array.from({ length: end - start }, (_, index) => start + index)
  if (focusedIndex !== null && focusedIndex < count && !indexes.includes(focusedIndex)) indexes.push(focusedIndex)
  return indexes.sort((a, b) => a - b)
}
