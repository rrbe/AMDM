/**
 * Pine CodeMirror themes — light + dark variants that match the app's "Pine"
 * design system (see styles.css). We build them with @uiw/codemirror-themes'
 * `createTheme` so the editor reads as part of the same surface rather than
 * CodeMirror's generic light/dark defaults.
 *
 * Two explicit themes (resolved hex, not CSS vars) keep rendering predictable:
 * ShellEditor swaps between them on the persisted `theme` preference. Colors
 * mirror the warm Pine syntax palette — pine props, olive strings, rust
 * numbers/keywords, plum booleans, brown ObjectId/types.
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
  bg: '#fbf9f3',
  text: '#1e231f',
  caret: '#1d7a4a',
  selection: 'rgba(29, 122, 74, 0.18)',
  lineHighlight: 'rgba(40, 44, 28, 0.05)',
  gutterFg: '#a6a99c',
  keyword: '#b15a1e',
  string: '#5f7a2c',
  number: '#b15a1e',
  bool: '#7c5aa0',
  property: '#1d7a4a',
  punct: '#9a9d90',
  comment: '#a6a99c',
  type: '#9a6a2d',
  regexp: '#7c5aa0'
}

const DARK: PinePalette = {
  base: 'dark',
  bg: '#0f0e0a',
  text: '#e9e4d6',
  caret: '#46b87a',
  selection: 'rgba(70, 184, 122, 0.24)',
  lineHighlight: 'rgba(255, 250, 235, 0.05)',
  gutterFg: '#5b5547',
  keyword: '#d99a52',
  string: '#9fc26a',
  number: '#d99a52',
  bool: '#b89ad0',
  property: '#46b87a',
  punct: '#6b6657',
  comment: '#5b5547',
  type: '#c99a5a',
  regexp: '#b89ad0'
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
