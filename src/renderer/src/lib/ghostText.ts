/**
 * Inline ghost-text suggestions for the shell editor (Copilot-style).
 *
 * A StateField holds at most one widget decoration rendering greyed value text
 * just after the cursor (e.g. `-1` after `sort({ _id: `). The hint is recomputed
 * by the pure `computeInlineHint` on every doc/selection change. It is mutually
 * exclusive with the autocomplete dropdown — cleared whenever a completion is
 * active — and accepted with Tab via `acceptGhost` (wired in ShellEditor's
 * keymap, ordered after `acceptCompletion`).
 */
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { StateField, type Extension } from '@codemirror/state'
import { completionStatus } from '@codemirror/autocomplete'
import { computeInlineHint } from '@renderer/lib/inlineHint'

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super()
  }
  // Reuse the same DOM when the text is unchanged → no flicker on unrelated edits.
  eq(other: GhostWidget): boolean {
    return other.text === this.text
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-ghost-text'
    span.textContent = this.text
    span.setAttribute('aria-hidden', 'true')
    return span
  }
  // Purely visual; never let the widget become a click/caret target.
  ignoreEvent(): boolean {
    return true
  }
}

const ghostField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    const { state } = tr
    // Mutually exclusive with the dropdown: hide the ghost while it's open/pending.
    if (completionStatus(state) !== null) return Decoration.none
    // Only recompute on doc/selection change; otherwise keep the mapped set.
    if (!tr.docChanged && !tr.selection) return deco.map(tr.changes)
    // Single empty cursor only — no ghost during multi-cursor or a selection.
    const sel = state.selection
    if (sel.ranges.length !== 1 || !sel.main.empty) return Decoration.none

    const pos = sel.main.head
    const hint = computeInlineHint(state.sliceDoc(0, pos))
    if (!hint) return Decoration.none
    // side: 1 → drawn after the cursor when the cursor sits at this position.
    const widget = Decoration.widget({ widget: new GhostWidget(hint.insert), side: 1 })
    return Decoration.set([widget.range(pos)])
  },
  provide: (f) => EditorView.decorations.from(f)
})

/**
 * Accept the current ghost text, inserting it at the cursor. Returns false when
 * there is no ghost (so a Tab keybinding can fall through to indentation). After
 * the insert, the value slot is filled, so the next field update clears the
 * ghost automatically — no stale suggestion.
 */
export function acceptGhost(view: EditorView): boolean {
  const deco = view.state.field(ghostField, false)
  if (!deco || deco.size === 0) return false
  const pos = view.state.selection.main.head
  let inserted = false
  deco.between(0, view.state.doc.length, (_from, _to, d) => {
    const w = d.spec.widget
    if (w instanceof GhostWidget) {
      view.dispatch({
        changes: { from: pos, insert: w.text },
        selection: { anchor: pos + w.text.length },
        userEvent: 'input.complete'
      })
      inserted = true
      return false // stop iterating
    }
    return undefined
  })
  return inserted
}

export function ghostText(): Extension {
  return [ghostField]
}
