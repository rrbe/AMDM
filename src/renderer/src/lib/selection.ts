/**
 * Row/document multi-selection model, shared by the Table and Tree result views
 * (and previously duplicated inline in both). Pure and immutable: it never
 * mutates the incoming set, always returning a fresh `Set` — which the views
 * rely on for correct React re-renders (see CLAUDE.md: Set updates must be
 * immutable).
 *
 * Behavior mirrors NoSQLBooster / a file list:
 *   - plain click  → select just the clicked index, and make it the anchor.
 *   - Shift+click  → select the contiguous range from the anchor to the click
 *                    (the anchor stays put, so you can re-extend).
 *   - ⌘/Ctrl+click → toggle the clicked index in/out of the selection, and move
 *                    the anchor to it.
 */
export interface SelectionMods {
  shift: boolean
  meta: boolean
  ctrl: boolean
}

export interface SelectionState {
  selection: Set<number>
  /** The index a subsequent Shift+click extends from (null = none). */
  anchor: number | null
}

export function computeSelection(
  prev: ReadonlySet<number>,
  clicked: number,
  anchor: number | null,
  mods: SelectionMods
): SelectionState {
  // Shift extends a contiguous range from the anchor; the anchor is preserved.
  if (mods.shift && anchor !== null) {
    const [a, b] = anchor <= clicked ? [anchor, clicked] : [clicked, anchor]
    const selection = new Set<number>()
    for (let i = a; i <= b; i++) selection.add(i)
    return { selection, anchor }
  }
  // ⌘/Ctrl toggles a single index and re-anchors there.
  if (mods.meta || mods.ctrl) {
    const selection = new Set(prev)
    if (selection.has(clicked)) selection.delete(clicked)
    else selection.add(clicked)
    return { selection, anchor: clicked }
  }
  // Plain click selects just this index and re-anchors.
  return { selection: new Set([clicked]), anchor: clicked }
}
