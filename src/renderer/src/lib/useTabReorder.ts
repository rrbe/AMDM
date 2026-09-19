import type { RefObject } from 'react'
import { useHorizontalReorder } from './useHorizontalReorder'

const TAB_REORDER = {
  itemSelector: '.document-tab',
  idAttribute: 'data-tab-id',
  ignoreSelector: 'button',
  sortingClass: 'tab-strip-sorting',
  draggingClass: 'document-tab-dragging'
}

/** Shared pointer sorting for the Query and Result tab strips. */
export function useTabReorder(
  stripRef: RefObject<HTMLDivElement | null>,
  tabs: readonly { id: string }[],
  onSelect: (id: string) => void,
  onMove: (sourceId: string, targetId: string) => void
): void {
  // Updating query text or receiving a result must not interrupt a query-tab drag.
  const order = JSON.stringify(tabs.map((tab) => tab.id))
  useHorizontalReorder(stripRef, order, TAB_REORDER, onMove, onSelect)
}
