import { Suspense, lazy, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { javascript } from '@codemirror/lang-javascript'
import { autocompletion } from '@codemirror/autocomplete'
import { EditorView } from '@codemirror/view'
import { useAppStore } from '@renderer/store/useAppStore'
import { pineLight, pineDark } from '@renderer/lib/pineEditorTheme'
import { useIsDark } from '@renderer/lib/useIsDark'
import { makeStageCompletionSource, type StageTarget } from '@renderer/lib/stageCompletion'

const CodeMirror = lazy(() => import('@uiw/react-codemirror'))

interface StageEditorProps {
  value: string
  onChange: (value: string) => void
  /** Target collection for field-name completion (null until a connection/db). */
  target: StageTarget | null
}

/**
 * A small CodeMirror for one pipeline stage's body — the same Pine theme +
 * JS highlighting as the main editor, but stripped of its run/save/menu wiring.
 * Completion offers aggregation operators ($-prefixed) and the target
 * collection's field names (see lib/stageCompletion).
 */
export function StageEditor({ value, onChange, target }: StageEditorProps): JSX.Element {
  const { t } = useTranslation()
  const isDark = useIsDark()
  const fontSize = useAppStore((s) => s.settings.editorFontSize)

  // Read the live target through a ref so `extensions` stays a stable reference
  // (rebuilding it per collection change would reconfigure CodeMirror).
  const targetRef = useRef(target)
  targetRef.current = target

  const extensions = useMemo(
    () => [
      javascript({ typescript: false }),
      autocompletion({ override: [makeStageCompletionSource(() => targetRef.current)] }),
      EditorView.contentAttributes.of({ autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false' }),
      EditorView.theme({ '&': { fontSize: `${fontSize}px` } }),
      EditorView.lineWrapping
    ],
    [fontSize]
  )

  return (
    <Suspense fallback={<div className="stage-editor-loading">{t('shell.loadingEditor')}</div>}>
      <CodeMirror
        className="stage-editor"
        value={value}
        theme={isDark ? pineDark : pineLight}
        extensions={extensions}
        indentWithTab={false}
        onChange={onChange}
        basicSetup={{
          lineNumbers: false,
          highlightActiveLine: false,
          foldGutter: false,
          autocompletion: false,
          searchKeymap: false
        }}
      />
    </Suspense>
  )
}
