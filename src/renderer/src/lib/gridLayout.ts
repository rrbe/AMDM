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
