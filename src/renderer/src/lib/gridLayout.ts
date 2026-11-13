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

export function gridRowFieldCounts(
  documents: readonly { value: unknown; keys: readonly string[] | null }[],
  visibleFields: readonly string[] | null,
  columns: number
): number[] {
  const selected = visibleFields === null ? null : new Set(visibleFields)
  const selectedKeys = selected ? [...selected] : null
  const rows: number[] = []
  documents.forEach(({ value, keys }, index) => {
    const count =
      keys === null
        ? 1
        : selected === null
          ? keys.length
          : selectedKeys!.length < keys.length
            ? selectedKeys!.reduce((total, key) => total + Number(Object.hasOwn(value as object, key)), 0)
            : keys.reduce((total, key) => total + Number(selected.has(key)), 0)
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
