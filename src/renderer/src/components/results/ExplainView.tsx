/**
 * Visual explain view.
 *
 * Renders an `explain('executionStats')` document (an EJSON-canonical plain
 * object) as three sections:
 *
 *  1. Summary bar — nReturned, totalDocsExamined, totalKeysExamined,
 *     executionTimeMillis + the winning plan's index.
 *  2. Stage tree — a graphical, connected-box tree of the execution stages
 *     (root/output at the top, scans at the leaves), following inputStage(s).
 *     COLLSCAN boxes are red, IXSCAN/IDHACK green, others neutral.
 *  3. Raw JSON — the full plan, pretty-printed and scrollable.
 *
 * All parsing lives in `lib/explain.ts` (pure, unit-tested); this component is
 * just presentation. Unknown shapes yield an empty tree and fall back to the
 * raw JSON — nothing here throws.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { indentFor, toJsonLines } from '@renderer/lib/format'
import { parseExplain, type StageTreeNode } from '@renderer/lib/explain'

interface ExplainViewProps {
  plan: unknown
}

/** Format a number for display, or '—' when unavailable. */
function fmtNum(v: number | undefined): string {
  return v === undefined ? '—' : v.toLocaleString()
}

export function ExplainView({ plan }: ExplainViewProps): React.JSX.Element {
  const { t } = useTranslation()
  const parsed = useMemo(() => parseExplain(plan), [plan])
  const rawLines = useMemo(() => toJsonLines(plan), [plan])

  return (
    <div className="explain-view">
      <div className="explain-summary">
        <SummaryStat label="nReturned" value={fmtNum(parsed.summary.nReturned)} />
        <SummaryStat label={t('explain.docsExamined')} value={fmtNum(parsed.summary.docsExamined)} />
        <SummaryStat label={t('explain.keysExamined')} value={fmtNum(parsed.summary.keysExamined)} />
        <SummaryStat
          label={t('explain.time')}
          value={parsed.summary.timeMs === undefined ? '—' : `${parsed.summary.timeMs} ms`}
        />
        <SummaryStat label={t('explain.index')} value={parsed.winningIndex ?? t('explain.none')} mono />
      </div>

      <div className="explain-stages">
        {parsed.roots.length === 0 ? (
          <div className="muted explain-empty">{t('explain.noStages')}</div>
        ) : (
          <div className="explain-tree">
            <ul>
              {parsed.roots.map((node, i) => (
                <StageBranch key={i} node={node} />
              ))}
            </ul>
          </div>
        )}
      </div>

      <details className="explain-raw">
        <summary>{t('explain.rawJson')}</summary>
        <div className="explain-raw-box">
          {rawLines.map((line, i) => (
            <pre key={i} className="explain-raw-line">
              {indentFor(line.depth)}
              {line.text}
            </pre>
          ))}
        </div>
      </details>
    </div>
  )
}

function SummaryStat({ label, value, mono }: { label: string; value: string; mono?: boolean }): React.JSX.Element {
  return (
    <div className="explain-stat">
      <span className="explain-stat-label">{label}</span>
      <span className={mono ? 'explain-stat-value mono' : 'explain-stat-value'}>{value}</span>
    </div>
  )
}

/** One stage box plus, recursively, its input stages as connected children. */
function StageBranch({ node }: { node: StageTreeNode }): React.JSX.Element {
  return (
    <li>
      <StageCard node={node} />
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child, i) => (
            <StageBranch key={i} node={child} />
          ))}
        </ul>
      )}
    </li>
  )
}

function StageCard({ node }: { node: StageTreeNode }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className={`explain-card tone-${node.tone}`}>
      <span className="explain-stage-name">{node.stage}</span>
      <span className="explain-stage-metrics">
        <Metric label={t('explain.metricN')} value={fmtNum(node.nReturned)} />
        {node.docsExamined !== undefined && (
          <Metric label={t('explain.metricDocs')} value={fmtNum(node.docsExamined)} />
        )}
        {node.keysExamined !== undefined && (
          <Metric label={t('explain.metricKeys')} value={fmtNum(node.keysExamined)} />
        )}
        {node.timeMs !== undefined && (
          <Metric label={t('explain.metricTime')} value={`${node.timeMs} ms`} />
        )}
      </span>
      {(node.indexName || node.keyPattern) && (
        <span className="explain-stage-index">{node.indexName ?? node.keyPattern}</span>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <span className="explain-metric">
      <span className="explain-metric-label">{label}</span>
      <span className="explain-metric-value">{value}</span>
    </span>
  )
}
