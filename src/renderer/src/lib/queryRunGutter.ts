import { Prec, RangeSet, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, gutter, type DecorationSet } from '@codemirror/view'
import { shellStatementAt, type ShellStatement } from './shellStatement'

interface QueryRunGutterOptions {
  label: string
  onRun: (code: string) => void
}

interface StatementRange {
  from: number
  to: number
}

const setHoveredStatement = StateEffect.define<StatementRange | null>()
const setRunBusy = StateEffect.define<boolean>()
const hoveredLine = Decoration.line({ class: 'cm-query-statement-hover' })

const hoveredStatementField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value
    if (transaction.docChanged || !transaction.startState.selection.eq(transaction.state.selection)) {
      next = Decoration.none
    }
    for (const effect of transaction.effects) {
      if (effect.is(setHoveredStatement)) {
        next = effect.value ? statementDecorations(transaction.state, effect.value) : Decoration.none
      }
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field)
})

const runBusyField = StateField.define({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setRunBusy)) value = effect.value
    return value
  }
})

class QueryRunMarker extends GutterMarker {
  readonly elementClass = 'cm-query-run-marker'

  constructor(
    private readonly statement: ShellStatement,
    private readonly busy: boolean,
    private readonly options: QueryRunGutterOptions
  ) {
    super()
  }

  eq(other: QueryRunMarker): boolean {
    return (
      this.statement.from === other.statement.from &&
      this.statement.to === other.statement.to &&
      this.statement.code === other.statement.code &&
      this.busy === other.busy &&
      this.options.label === other.options.label
    )
  }

  toDOM(view: EditorView): Node {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cm-query-run-button'
    button.disabled = this.busy
    button.setAttribute('aria-label', this.options.label)
    button.title = this.options.label

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    icon.setAttribute('viewBox', '0 0 24 24')
    icon.setAttribute('aria-hidden', 'true')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('class', 'cm-query-run-icon-play')
    path.setAttribute('d', 'm7.5 5.5 10 6.5-10 6.5z')
    icon.appendChild(path)
    button.appendChild(icon)

    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (!this.busy) {
        view.dispatch({ effects: setHoveredStatement.of(null) })
        this.options.onRun(this.statement.code)
      }
    })
    button.addEventListener('mouseenter', () => {
      view.dispatch({
        effects: setHoveredStatement.of({
          from: this.statement.from,
          to: this.statement.to
        })
      })
    })
    button.addEventListener('mouseleave', () => {
      view.dispatch({ effects: setHoveredStatement.of(null) })
    })

    return button
  }
}

export function queryRunGutter(options: QueryRunGutterOptions): Extension {
  return [
    hoveredStatementField,
    runBusyField,
    EditorView.focusChangeEffect.of((_state, focusing) => (focusing ? null : setHoveredStatement.of(null))),
    Prec.highest(
      gutter({
        class: 'cm-query-run-gutter',
        renderEmptyElements: true,
        markers: (view) => {
          if (!view.hasFocus) return RangeSet.empty
          const statement = shellStatementAt(view.state)
          if (!statement) return RangeSet.empty
          const marker = new QueryRunMarker(statement, view.state.field(runBusyField), options)
          return RangeSet.of([marker.range(statement.firstLineFrom)])
        }
      })
    )
  ]
}

export function updateQueryRunBusy(view: EditorView, busy: boolean): void {
  if (view.state.field(runBusyField, false) === busy) return
  view.dispatch({ effects: setRunBusy.of(busy) })
}

function statementDecorations(state: EditorState, range: StatementRange): DecorationSet {
  const decorations = []
  const firstLine = state.doc.lineAt(range.from).number
  const lastLine = state.doc.lineAt(range.to).number
  for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
    decorations.push(hoveredLine.range(state.doc.line(lineNumber).from))
  }
  return Decoration.set(decorations)
}
