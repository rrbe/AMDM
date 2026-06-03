import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { javascript } from '@codemirror/lang-javascript'
import { acceptCompletion, autocompletion } from '@codemirror/autocomplete'
import { keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { indentLess, insertTab } from '@codemirror/commands'
import { mongoCompletionSource } from '@renderer/lib/mongoCompletion'
import { useAppStore } from '@renderer/store/useAppStore'
import { pineLight, pineDark } from '@renderer/lib/pineEditorTheme'

/**
 * CodeMirror is heavy, so we lazy-load it (ADR-0004 rule 7) — it stays out of
 * the initial bundle and only loads when the shell workspace first renders.
 *
 * Shortcuts live INSIDE CodeMirror as a high-precedence keymap (not on a React
 * wrapper). A wrapper keydown fires in the bubble phase, after CodeMirror has
 * already handled the key natively — too late to suppress its defaults. The old
 * approach let Cmd+Enter both run AND insert a blank line (CodeMirror's
 * defaultKeymap binds Mod-Enter → insertBlankLine, and Mod = Cmd on macOS).
 * Binding at Prec.highest and returning true shadows that default and natively
 * preventDefaults, while every other default binding (Cmd/Opt+Arrow navigation,
 * word/line motion, etc.) stays intact.
 */
const CodeMirror = lazy(() => import('@uiw/react-codemirror'))

interface ShellEditorProps {
  value: string
  onChange: (value: string) => void
  onRun: () => void
  onSave: () => void
  onExplain: () => void
  /** Pretty-print the editor (Shift+Alt+F) — independent of `busy`. */
  onFormat: () => void
  /** When true (a query is running, or the editor is empty) run/save/explain
      keys are swallowed without acting — mirroring the disabled toolbar buttons. */
  busy: boolean
}

export function ShellEditor({
  value,
  onChange,
  onRun,
  onSave,
  onExplain,
  onFormat,
  busy
}: ShellEditorProps): JSX.Element {
  // Follow the app's Pine light/dark preference so the editor reads as part of
  // the same surface (custom Pine themes, not CodeMirror's generic defaults).
  // 'system' must be resolved to the live OS appearance — otherwise "follow
  // system" leaves the editor stuck on light while the rest of the app is dark.
  const theme = useAppStore((s) => s.settings.theme)
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  useEffect(() => {
    if (theme !== 'system') return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = (): void => setSystemDark(mql.matches)
    sync() // re-read in case the OS toggled while we weren't following it
    mql.addEventListener('change', sync)
    return () => mql.removeEventListener('change', sync)
  }, [theme])
  const isDark = theme === 'dark' || (theme === 'system' && systemDark)

  // Hold the latest callbacks in a ref so the keymap extension can stay a stable
  // reference — recreating `extensions` would reconfigure CodeMirror on every
  // keystroke (ADR-0004). The bindings read fresh props through this ref.
  const handlers = useRef({ onRun, onSave, onExplain, onFormat, busy })
  handlers.current = { onRun, onSave, onExplain, onFormat, busy }

  const extensions = useMemo(
    () => [
      javascript({ typescript: false }),
      autocompletion({ override: [mongoCompletionSource] }),
      Prec.highest(
        keymap.of([
          // Cmd+Enter and Ctrl+Enter both run. Returning true consumes the key
          // (no blank line); plain Enter is left to CodeMirror as a newline.
          { key: 'Mod-Enter', run: () => runIfReady() },
          { key: 'Ctrl-Enter', run: () => runIfReady() },
          // Cmd/Ctrl+S saves; preventDefault stops the browser "save page" dialog.
          { key: 'Mod-s', preventDefault: true, run: () => saveIfReady() },
          // Cmd/Ctrl+E runs explain().
          { key: 'Mod-e', run: () => explainIfReady() },
          // Shift+Alt+F formats the script (VS Code's convention). preventDefault
          // stops macOS Option+F from inserting a stray "ƒ" glyph.
          { key: 'Shift-Alt-f', preventDefault: true, run: () => formatNow() },
          // Tab: accept the open completion, else insert one indent unit (2
          // spaces via basicSetup.tabSize, or indent a multi-line selection).
          { key: 'Tab', run: (view) => acceptCompletion(view) || insertTab(view), shift: indentLess }
        ])
      )
    ],
    []
  )

  return (
    <div className="editor-wrap">
      <Suspense fallback={<div className="editor-loading">Loading editor…</div>}>
        <CodeMirror
          value={value}
          height="100%"
          theme={isDark ? pineDark : pineLight}
          extensions={extensions}
          indentWithTab={false}
          onChange={onChange}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLine: true,
            foldGutter: false,
            autocompletion: false,
            tabSize: 2
          }}
        />
      </Suspense>
    </div>
  )

  // Defined after the return-bearing render but hoisted: these read the ref so
  // they always see the current props, and always return true to consume the key.
  function runIfReady(): boolean {
    if (!handlers.current.busy) handlers.current.onRun()
    return true
  }
  function saveIfReady(): boolean {
    if (!handlers.current.busy) handlers.current.onSave()
    return true
  }
  function explainIfReady(): boolean {
    if (!handlers.current.busy) handlers.current.onExplain()
    return true
  }
  // Formatting is a pure editor op, so it stays available even while a query
  // runs (unlike run/save/explain); the store no-ops on empty input.
  function formatNow(): boolean {
    handlers.current.onFormat()
    return true
  }
}
