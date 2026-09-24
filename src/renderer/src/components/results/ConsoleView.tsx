import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ShellOutputLine } from '@shared/types'
import { consoleText, toConsoleLines } from '@renderer/lib/consoleOutput'
import { useCopyHotkey } from '@renderer/lib/useCopyHotkey'
import { FoldableJsonLines } from './FoldableJsonLines'

/**
 * Console output of a run: every print/printjson/console.* line, in call
 * order, virtualized BY LINE like the JSON view (a
 * forEach(printjson) easily produces thousands of lines). printjson payloads
 * reuse the JSON view's shell-style tokens; warn/error lines are tinted.
 * Text is natively selectable; ⌘C with no selection copies the whole console.
 */

interface ConsoleViewProps {
  output: ShellOutputLine[]
  fontSize: number
  controlsContainer: HTMLElement | null
  /** True when the engine dropped lines beyond the capture cap. */
  truncated?: boolean
}

export function ConsoleView({ output, fontSize, truncated, controlsContainer }: ConsoleViewProps): React.JSX.Element {
  const { t } = useTranslation()
  const lines = useMemo(() => toConsoleLines(output), [output])

  useCopyHotkey(() => consoleText(output))

  return (
    <div className="console-view-wrap">
      {truncated && <div className="console-truncated">{t('result.consoleTruncated')}</div>}
      <FoldableJsonLines
        lines={lines}
        fontSize={fontSize}
        controlsContainer={controlsContainer}
        includeRootInCollapseAll
        rowClassName={(line) => `console-line${line.level !== 'log' ? ` ${line.level}` : ''}`}
      />
    </div>
  )
}
