/**
 * Compass CodeMirror themes — light + dark variants that match the app's
 * "Compass" design system (see styles.css), modeled on MongoDB Compass /
 * LeafyGreen. We build them with @uiw/codemirror-themes' `createTheme` so the
 * editor reads as part of the same surface rather than CodeMirror's generic
 * light/dark defaults.
 *
 * Two explicit themes (resolved hex, not CSS vars) keep rendering predictable:
 * ShellEditor swaps between them on the persisted `theme` preference. Colors
 * mirror the Compass document palette — green method calls, green strings,
 * blue numbers, purple booleans/keywords, coral ObjectId/types.
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
  text: '#001e2b',
  caret: '#00684a',
  selection: 'rgba(0, 104, 74, 0.16)',
  lineHighlight: 'rgba(0, 30, 43, 0.04)',
  gutterFg: '#889397',
  keyword: '#883ea8',
  string: '#12824d',
  number: '#1254b7',
  bool: '#883ea8',
  property: '#00684a',
  punct: '#5c6c75',
  comment: '#889397',
  type: '#c2371a',
  regexp: '#883ea8'
}

const DARK: PinePalette = {
  base: 'dark',
  bg: '#001a26',
  text: '#e8edeb',
  caret: '#00ed64',
  selection: 'rgba(0, 237, 100, 0.22)',
  lineHighlight: 'rgba(255, 255, 255, 0.04)',
  gutterFg: '#5c6c75',
  keyword: '#c39bf3',
  string: '#35de7e',
  number: '#6ca8ff',
  bool: '#c39bf3',
  property: '#00ed64',
  punct: '#889397',
  comment: '#5c6c75',
  type: '#ff6f4d',
  regexp: '#c39bf3'
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
