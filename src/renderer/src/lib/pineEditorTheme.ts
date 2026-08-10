/**
 * CodeMirror themes — light + dark variants that match the app's
 * semantic design tokens (see styles/tokens.css): neutral paper in light mode,
 * a graphite accent (caret / selection), and semantic syntax colors.
 * We build them with
 * @uiw/codemirror-themes' `createTheme` so the editor reads as part of the same
 * surface rather than CodeMirror's generic light/dark defaults.
 *
 * ShellEditor swaps between two structural light/dark themes. User-editable
 * colors come from CSS variables so a Settings preview can update CodeMirror
 * and result values without rebuilding the editor.
 */
import { createTheme } from '@uiw/codemirror-themes'
import { tags as t } from '@lezer/highlight'

interface PinePalette {
  base: 'light' | 'dark'
  caret: string
  selection: string
  lineHighlight: string
  punct: string
}

const LIGHT: PinePalette = {
  base: 'light',
  caret: '#242529',
  selection: 'rgba(22, 24, 29, 0.11)',
  lineHighlight: 'rgba(22, 24, 29, 0.045)',
  punct: '#55585f'
}

const DARK: PinePalette = {
  base: 'dark',
  caret: '#f0f0f2',
  selection: 'rgba(255, 255, 255, 0.13)',
  lineHighlight: 'rgba(255, 255, 255, 0.05)',
  punct: '#b8bac0'
}

function build(p: PinePalette): ReturnType<typeof createTheme> {
  return createTheme({
    theme: p.base,
    settings: {
      background: 'var(--editor-background)',
      foreground: 'var(--editor-foreground)',
      caret: p.caret,
      selection: p.selection,
      selectionMatch: p.selection,
      lineHighlight: p.lineHighlight,
      gutterBackground: 'var(--editor-background)',
      gutterForeground: 'var(--editor-comment)',
      gutterBorder: 'transparent',
      fontFamily: 'var(--font-mono)'
    },
    styles: [
      { tag: [t.keyword, t.operatorKeyword, t.modifier], color: 'var(--editor-keyword)' },
      { tag: [t.string, t.special(t.string)], color: 'var(--editor-string)' },
      { tag: [t.number], color: 'var(--editor-number)' },
      { tag: [t.bool, t.null, t.atom], color: 'var(--editor-keyword)' },
      { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--editor-keyword)' },
      // Keep called members distinct from collection and document keys.
      { tag: [t.function(t.propertyName), t.function(t.variableName)], color: 'var(--editor-number)' },
      { tag: [t.variableName, t.definition(t.variableName)], color: 'var(--editor-foreground)' },
      { tag: [t.punctuation, t.separator, t.bracket, t.brace, t.squareBracket, t.paren], color: p.punct },
      { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--editor-comment)', fontStyle: 'italic' },
      { tag: [t.className, t.typeName, t.namespace], color: 'var(--editor-type)' },
      { tag: [t.regexp], color: 'var(--editor-keyword)' }
    ]
  })
}

export const pineLight = build(LIGHT)
export const pineDark = build(DARK)
