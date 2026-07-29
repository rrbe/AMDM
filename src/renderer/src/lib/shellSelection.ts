import type { EditorState } from '@codemirror/state'

/** The selected snippet for the normal Run action; no selection means run all. */
export function selectionCode(state?: EditorState): string | undefined {
  if (!state) return undefined
  const sel = state.selection.main
  return sel.empty ? undefined : state.sliceDoc(sel.from, sel.to).trim()
}
