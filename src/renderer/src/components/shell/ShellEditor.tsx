import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { javascript } from '@codemirror/lang-javascript'
import { acceptCompletion, autocompletion } from '@codemirror/autocomplete'
import { EditorView, keymap } from '@codemirror/view'
import { Prec, EditorState } from '@codemirror/state'
import { indentLess, insertTab, redo, selectAll, toggleComment, undo } from '@codemirror/commands'
import { openSearchPanel, search } from '@codemirror/search'
import { syntaxTree, indentUnit } from '@codemirror/language'
import { mongoCompletionSource } from '@renderer/lib/mongoCompletion'
import { useAppStore } from '@renderer/store/useAppStore'
import { pineLight, pineDark } from '@renderer/lib/pineEditorTheme'
import { ContextMenu, type ContextMenuEntry } from '@renderer/components/ContextMenu'

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

const FONT_MIN = 10
const FONT_MAX = 24
const FONT_DEFAULT = 13

// Editor-preference mutators (font size / word wrap / tab width). Kept at module
// scope and reading fresh store state via getState() so the CodeMirror keymap can
// call them without capturing stale closures; each persists to AppSettings.
function adjustFontSize(delta: number): void {
  const store = useAppStore.getState()
  const next = Math.min(FONT_MAX, Math.max(FONT_MIN, store.settings.editorFontSize + delta))
  if (next !== store.settings.editorFontSize) void store.updateSettings({ editorFontSize: next })
}
function resetFontSize(): void {
  void useAppStore.getState().updateSettings({ editorFontSize: FONT_DEFAULT })
}
function toggleWordWrap(): void {
  const store = useAppStore.getState()
  void store.updateSettings({ editorWordWrap: !store.settings.editorWordWrap })
}
function cycleTabSize(): void {
  const store = useAppStore.getState()
  void store.updateSettings({ editorTabSize: store.settings.editorTabSize === 2 ? 4 : 2 })
}

interface ShellEditorProps {
  value: string
  onChange: (value: string) => void
  onRun: () => void
  /** Run just the current statement / selection (right-click menu, F6). */
  onRunStatement: (code: string) => void
  onSave: () => void
  onExplain: () => void
  /** Pretty-print the editor (Shift+Alt+F) — independent of `busy`. */
  onFormat: () => void
  /** Cancel the in-flight run (the "停止执行" menu item / toolbar Stop). */
  onStop: () => void
  /** True while a query is running — enables Stop, disables the run actions. */
  running: boolean
  /** When true (a query is running, or the editor is empty) run/save/explain
      keys are swallowed without acting — mirroring the disabled toolbar buttons. */
  busy: boolean
}

export function ShellEditor({
  value,
  onChange,
  onRun,
  onRunStatement,
  onSave,
  onExplain,
  onFormat,
  onStop,
  running,
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

  // Editor preferences (persisted to AppSettings; see the right-click menu and
  // ⌘+/⌘−/⌘0). These feed the extensions memo below, so a change reconfigures
  // CodeMirror — infrequent enough that the rebuild cost is irrelevant.
  const fontSize = useAppStore((s) => s.settings.editorFontSize)
  const wordWrap = useAppStore((s) => s.settings.editorWordWrap)
  const tabSize = useAppStore((s) => s.settings.editorTabSize)

  // The live EditorView, captured on mount. The right-click menu needs it to
  // drive native commands (undo/redo/select-all, toggle-comment, search) and to
  // read the selection / locate the current statement for "Run Current Statement".
  const viewRef = useRef<EditorView | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  // Hold the latest callbacks in a ref so the keymap extension can stay a stable
  // reference — recreating `extensions` would reconfigure CodeMirror on every
  // keystroke (ADR-0004). The bindings read fresh props through this ref.
  const handlers = useRef({ onRun, onRunStatement, onSave, onExplain, onFormat, onStop, running, busy })
  handlers.current = { onRun, onRunStatement, onSave, onExplain, onFormat, onStop, running, busy }

  const extensions = useMemo(
    () => [
      javascript({ typescript: false }),
      autocompletion({ override: [mongoCompletionSource] }),
      // Provides the Find/Replace panel that ⌘F and the menu's openSearchPanel open.
      search({ top: true }),
      // Editor preferences applied as extensions: font size cascades from the
      // editor root; tab width drives both the visual tab + the spaces Tab inserts.
      EditorView.theme({ '&': { fontSize: `${fontSize}px` } }),
      EditorState.tabSize.of(tabSize),
      indentUnit.of(' '.repeat(tabSize)),
      ...(wordWrap ? [EditorView.lineWrapping] : []),
      Prec.highest(
        keymap.of([
          // ⌘+ / ⌘− / ⌘0 resize the editor font (preventDefault stops Electron's
          // window-zoom from also firing). Available even while a query runs.
          { key: 'Mod-=', preventDefault: true, run: () => bumpFont(1) },
          { key: 'Mod-+', preventDefault: true, run: () => bumpFont(1) },
          { key: 'Mod--', preventDefault: true, run: () => bumpFont(-1) },
          { key: 'Mod-0', preventDefault: true, run: () => bumpFont(0) },
          // Cmd+Enter and Ctrl+Enter both run. Returning true consumes the key
          // (no blank line); plain Enter is left to CodeMirror as a newline.
          { key: 'Mod-Enter', run: () => runIfReady() },
          { key: 'Ctrl-Enter', run: () => runIfReady() },
          // F6 runs only the statement under the cursor (or the selection),
          // matching NoSQLBooster's "Run Current Statement".
          { key: 'F6', run: () => runStatementIfReady() },
          // Cmd/Ctrl+S saves; preventDefault stops the browser "save page" dialog.
          { key: 'Mod-s', preventDefault: true, run: () => saveIfReady() },
          // Cmd/Ctrl+E runs explain().
          { key: 'Mod-e', run: () => explainIfReady() },
          // Shift+Alt+F formats the script (VS Code's convention). preventDefault
          // stops macOS Option+F from inserting a stray "ƒ" glyph.
          { key: 'Shift-Alt-f', preventDefault: true, run: () => formatNow() },
          // Cmd/Ctrl+/ toggles line comments (also bound in defaultKeymap; pinned
          // here so it works regardless of basicSetup defaults).
          { key: 'Mod-/', run: (view) => toggleComment(view) },
          // Tab: accept the open completion, else insert one indent unit (the
          // configured tab width in spaces, or indent a multi-line selection).
          { key: 'Tab', run: (view) => acceptCompletion(view) || insertTab(view), shift: indentLess }
        ])
      )
    ],
    // Rebuild only when an editor preference changes (not per keystroke — the
    // run/save/explain callbacks are read through `handlers` ref).
    [fontSize, wordWrap, tabSize]
  )

  return (
    <div
      className="editor-wrap"
      onContextMenu={(e) => {
        if (!viewRef.current) return
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <Suspense fallback={<div className="editor-loading">Loading editor…</div>}>
        <CodeMirror
          value={value}
          height="100%"
          theme={isDark ? pineDark : pineLight}
          extensions={extensions}
          indentWithTab={false}
          onChange={onChange}
          onCreateEditor={(view) => {
            viewRef.current = view
          }}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLine: true,
            foldGutter: false,
            autocompletion: false
            // tabSize is set via the EditorState.tabSize extension (configurable).
          }}
        />
      </Suspense>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={buildMenu()} onClose={() => setMenu(null)} />
      )}
    </div>
  )

  // Defined after the return-bearing render but hoisted: these read the ref so
  // they always see the current props, and always return true to consume the key.
  function runIfReady(): boolean {
    if (!handlers.current.busy) handlers.current.onRun()
    return true
  }
  function runStatementIfReady(): boolean {
    const view = viewRef.current
    if (handlers.current.busy || !view) return true
    const code = statementCode(view)
    if (code) handlers.current.onRunStatement(code)
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
  // Font size: delta > 0 grows, < 0 shrinks, 0 resets. Always consumes the key.
  function bumpFont(delta: number): boolean {
    if (delta === 0) resetFontSize()
    else adjustFontSize(delta)
    return true
  }

  // Focus the editor first so native clipboard ops (execCommand) and CodeMirror
  // commands act on the editor's selection rather than the menu button.
  function withView(fn: (v: EditorView) => void): void {
    const v = viewRef.current
    if (!v) return
    v.focus()
    fn(v)
  }

  function buildMenu(): ContextMenuEntry[] {
    const { busy: isBusy, running: isRunning } = handlers.current
    const hasSel = viewRef.current ? !viewRef.current.state.selection.main.empty : false
    return [
      { label: '运行脚本', shortcut: '⌘↵', disabled: isBusy, onClick: () => runIfReady() },
      {
        label: hasSel ? '运行选中' : '运行当前语句',
        shortcut: 'F6',
        disabled: isBusy,
        onClick: () => runStatementIfReady()
      },
      { label: 'Explain', shortcut: '⌘E', disabled: isBusy, onClick: () => explainIfReady() },
      // Enabled only mid-run; cancels the in-flight find/aggregate server-side.
      { label: '停止执行', disabled: !isRunning, onClick: () => handlers.current.onStop() },
      'separator',
      { label: '格式化代码', shortcut: '⌥⇧F', onClick: () => formatNow() },
      { label: '切换注释', shortcut: '⌘/', onClick: () => withView((v) => toggleComment(v)) },
      'separator',
      // Editor preferences (persisted): the `：值` labels show current state,
      // since the menu closes on click (no live checkmark column).
      { label: `自动换行：${wordWrap ? '开' : '关'}`, onClick: () => toggleWordWrap() },
      { label: `Tab 宽度：${tabSize}`, onClick: () => cycleTabSize() },
      { label: '增大字号', shortcut: '⌘+', onClick: () => bumpFont(1) },
      { label: '减小字号', shortcut: '⌘−', onClick: () => bumpFont(-1) },
      'separator',
      { label: '查找 / 替换', shortcut: '⌘F', onClick: () => withView((v) => openSearchPanel(v)) },
      'separator',
      { label: '另存为…', shortcut: '⌘S', disabled: isBusy, onClick: () => saveIfReady() },
      'separator',
      { label: '撤销', shortcut: '⌘Z', onClick: () => withView((v) => undo(v)) },
      { label: '重做', shortcut: '⇧⌘Z', onClick: () => withView((v) => redo(v)) },
      'separator',
      { label: '剪切', shortcut: '⌘X', onClick: () => withView(() => document.execCommand('cut')) },
      { label: '复制', shortcut: '⌘C', onClick: () => withView(() => document.execCommand('copy')) },
      { label: '粘贴', shortcut: '⌘V', onClick: () => withView(() => document.execCommand('paste')) },
      { label: '全选', shortcut: '⌘A', onClick: () => withView((v) => selectAll(v)) }
    ]
  }
}

/**
 * The text to run for "Run Current Statement": the selection if there is one,
 * otherwise the top-level statement under the cursor — located via the JS syntax
 * tree (the direct child of the Script root containing, or just before, the
 * cursor). Falls back to the whole doc if the tree yields nothing.
 */
function statementCode(view: EditorView): string {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty) return state.sliceDoc(sel.from, sel.to).trim()
  const pos = sel.head
  const root = syntaxTree(state).topNode
  let chosen: typeof root | null = null
  let lastBefore: typeof root | null = null
  for (let child = root.firstChild; child; child = child.nextSibling) {
    if (pos >= child.from && pos <= child.to) {
      chosen = child
      break
    }
    if (child.to <= pos) lastBefore = child
  }
  const node = chosen ?? lastBefore ?? root.firstChild
  return (node ? state.sliceDoc(node.from, node.to) : state.doc.toString()).trim()
}
