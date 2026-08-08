/**
 * CodeMirror themes — light + dark variants that match the app's
 * semantic design tokens (see styles/tokens.css): neutral paper in light mode,
 * a graphite accent (caret / selection), and semantic syntax colors.
 * We build them with
 * @uiw/codemirror-themes' `createTheme` so the editor reads as part of the same
 * surface rather than CodeMirror's generic light/dark defaults.
 *
 * Two explicit themes (resolved hex, not CSS vars) keep rendering predictable:
 * ShellEditor swaps between them on the persisted `theme` preference. Syntax
 * colors mirror the styles/tokens.css --t-* value-type palette — green strings,
 * blue numbers, purple booleans/keywords, orange ObjectId/types, near-neutral
 * method calls — with a graphite caret. Keep these in sync with the --t-* tokens.
 */
import { createTheme } from '@uiw/codemirror-themes'
import { tags as t } from '@lezer/highlight'

interface PinePalette {
  base: 'light' | 'dark'
  bg: string
  text: string
  caret: string
  selection: string
  lineHighlight: string
  gutterFg: string
  /** syntax */
  keyword: string
  string: string
  number: string
  bool: string
  property: string
  method: string
  punct: string
  comment: string
  type: string
  regexp: string
}

const LIGHT: PinePalette = {
  base: 'light',
  bg: '#fafafa',
  text: '#202124',
  caret: '#242529',
  selection: 'rgba(22, 24, 29, 0.11)',
  lineHighlight: 'rgba(22, 24, 29, 0.045)',
  gutterFg: '#898c93',
  keyword: '#8657b8',
  string: '#237f50',
  number: '#4565c4',
  bool: '#8657b8',
  property: '#8657b8',
  method: '#4565c4',
  punct: '#55585f',
  comment: '#898c93',
  type: '#a95732',
  regexp: '#8657b8'
}

const DARK: PinePalette = {
  base: 'dark',
  bg: '#1b1b1e',
  text: '#f1f1f3',
  caret: '#f0f0f2',
  selection: 'rgba(255, 255, 255, 0.13)',
  lineHighlight: 'rgba(255, 255, 255, 0.05)',
  gutterFg: '#858890',
  keyword: '#c5a0f0',
  string: '#67c78f',
  number: '#79a7ff',
  bool: '#c5a0f0',
  property: '#c5a0f0',
  method: '#79a7ff',
  punct: '#b8bac0',
  comment: '#858890',
  type: '#ff9b73',
  regexp: '#c5a0f0'
}

function build(p: PinePalette): ReturnType<typeof createTheme> {
  return createTheme({
    theme: p.base,
    settings: {
      background: p.bg,
      foreground: p.text,
      caret: p.caret,
      selection: p.selection,
      selectionMatch: p.selection,
      lineHighlight: p.lineHighlight,
      gutterBackground: p.bg,
      gutterForeground: p.gutterFg,
      gutterBorder: 'transparent',
      fontFamily: 'var(--font-mono)'
    },
    styles: [
      { tag: [t.keyword, t.operatorKeyword, t.modifier], color: p.keyword },
      { tag: [t.string, t.special(t.string)], color: p.string },
      { tag: [t.number], color: p.number },
      { tag: [t.bool, t.null, t.atom], color: p.bool },
      { tag: [t.propertyName, t.definition(t.propertyName)], color: p.property },
      // Keep called members distinct from collection and document keys.
      { tag: [t.function(t.propertyName), t.function(t.variableName)], color: p.method },
      { tag: [t.variableName, t.definition(t.variableName)], color: p.text },
      { tag: [t.punctuation, t.separator, t.bracket, t.brace, t.squareBracket, t.paren], color: p.punct },
      { tag: [t.comment, t.lineComment, t.blockComment], color: p.comment, fontStyle: 'italic' },
      { tag: [t.className, t.typeName, t.namespace], color: p.type },
      { tag: [t.regexp], color: p.regexp }
    ]
  })
}

export const pineLight = build(LIGHT)
export const pineDark = build(DARK)
