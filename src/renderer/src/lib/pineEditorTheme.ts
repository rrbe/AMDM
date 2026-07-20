/**
 * CodeMirror themes — light + dark variants that match the app's "Zinc + Blue"
 * design system (see styles/tokens.css): neutral zinc surfaces, a single blue
 * accent (caret / selection), and semantic syntax colors. We build them with
 * @uiw/codemirror-themes' `createTheme` so the editor reads as part of the same
 * surface rather than CodeMirror's generic light/dark defaults.
 *
 * Two explicit themes (resolved hex, not CSS vars) keep rendering predictable:
 * ShellEditor swaps between them on the persisted `theme` preference. Syntax
 * colors mirror the styles/tokens.css --t-* value-type palette — green strings,
 * blue numbers, purple booleans/keywords, orange ObjectId/types, near-neutral
 * method calls — with a blue caret. Keep these in sync with the --t-* tokens.
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
  punct: string
  comment: string
  type: string
  regexp: string
}

const LIGHT: PinePalette = {
  base: 'light',
  bg: '#ffffff',
  text: '#18181b',
  caret: '#2f6bff',
  selection: 'rgba(47, 107, 255, 0.16)',
  lineHighlight: 'rgba(0, 0, 0, 0.035)',
  gutterFg: '#a1a1aa',
  keyword: '#8a3fd0',
  string: '#1a8f4c',
  number: '#2563eb',
  bool: '#8a3fd0',
  property: '#18181b',
  punct: '#71717a',
  comment: '#a1a1aa',
  type: '#c0481f',
  regexp: '#8a3fd0'
}

const DARK: PinePalette = {
  base: 'dark',
  bg: '#0d0d0f',
  text: '#fafafa',
  caret: '#4f7fff',
  selection: 'rgba(79, 127, 255, 0.24)',
  lineHighlight: 'rgba(255, 255, 255, 0.045)',
  gutterFg: '#71717a',
  keyword: '#c79bff',
  string: '#5fd39a',
  number: '#74a8ff',
  bool: '#c79bff',
  property: '#fafafa',
  punct: '#a1a1aa',
  comment: '#71717a',
  type: '#ff8a5c',
  regexp: '#c79bff'
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
      // `db.coll.find()` — the method chain reads as pine, like the prototype.
      { tag: [t.propertyName, t.function(t.propertyName), t.function(t.variableName)], color: p.property },
      { tag: [t.variableName, t.definition(t.variableName)], color: p.text },
      { tag: [t.punctuation, t.separator, t.bracket, t.brace, t.squareBracket, t.paren], color: p.punct },
      { tag: [t.comment, t.lineComment, t.blockComment], color: p.comment, fontStyle: 'italic' },
      { tag: [t.className, t.typeName, t.namespace], color: p.type },
      { tag: [t.regexp], color: p.regexp },
      { tag: [t.propertyName, t.definition(t.propertyName)], color: p.property }
    ]
  })
}

export const pineLight = build(LIGHT)
export const pineDark = build(DARK)
