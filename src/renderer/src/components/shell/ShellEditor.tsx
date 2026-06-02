import { Suspense, lazy, useMemo, type KeyboardEvent } from 'react'
import { javascript } from '@codemirror/lang-javascript'
import { autocompletion } from '@codemirror/autocomplete'
import { mongoCompletionSource } from '@renderer/lib/mongoCompletion'

/**
 * CodeMirror is heavy, so we lazy-load it (ADR-0004 rule 7) — it stays out of
 * the initial bundle and only loads when the shell workspace first renders.
 *
 * Cmd/Ctrl+Enter to run is handled on the wrapper's keydown (CodeMirror lets
 * the event bubble), so we don't need to import @codemirror/view directly and
 * can keep the dependency surface to exactly what's in package.json
 * (@uiw/react-codemirror + @codemirror/lang-javascript).
 */
const CodeMirror = lazy(() => import('@uiw/react-codemirror'))

interface ShellEditorProps {
  value: string
  onChange: (value: string) => void
  onRun: () => void
}

export function ShellEditor({ value, onChange, onRun }: ShellEditorProps): JSX.Element {
  const extensions = useMemo(
    () => [javascript({ typescript: false }), autocompletion({ override: [mongoCompletionSource] })],
    []
  )

  const onWrapperKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      onRun()
    }
  }

  return (
    <div className="editor-wrap" onKeyDown={onWrapperKeyDown}>
      <Suspense fallback={<div className="editor-loading">Loading editor…</div>}>
        <CodeMirror
          value={value}
          height="160px"
          theme="dark"
          extensions={extensions}
          onChange={onChange}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLine: true,
            foldGutter: false,
            autocompletion: false
          }}
        />
      </Suspense>
    </div>
  )
}
