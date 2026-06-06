/**
 * Visual explain view.
 *
 * Parses an `explain('executionStats')` document (an EJSON-canonical plain
 * object) and renders three sections:
 *
 *  1. Summary bar — nReturned, totalDocsExamined, totalKeysExamined,
 *     executionTimeMillis (from `executionStats`) + the winning plan's index.
 *  2. Stage tree — a flattened walk of the execution stages, following
 *     `inputStage` / `inputStages[]`. COLLSCAN is red, IXSCAN/IDHACK green,
 *     others neutral.
 *  3. Raw JSON — the full plan, pretty-printed and scrollable.
 *
 * Explain shapes vary a lot (find vs aggregate vs sharded vs server version),
 * so every extraction is defensive: we show whatever we can find and always
 * fall back to the raw JSON. Nothing here throws.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { indentFor, toJsonLines } from '@renderer/lib/format'

interface ExplainViewProps {
  plan: unknown
}

type Dict = Record<string, unknown>

function isObj(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Coerce an EJSON-wrapped or plain number to a JS number (NaN on failure). */
function toNum(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') return Number(v)
  if (isObj(v)) {
    for (const k of ['$numberInt', '$numberLong', '$numberDouble', '$numberDecimal']) {
      if (k in v) return Number(v[k])
    }
  }
  return NaN
}

/** Format a number for display, or '—' when unavailable. */
function fmtNum(v: unknown): string {
  const n = toNum(v)
  return Number.isNaN(n) ? '—' : n.toLocaleString()
}

/**
 * A flattened stage node for the indented tree. Children come from
 * `inputStage` (single) and/or `inputStages` (array of) recursively.
 */
interface StageNode {
  depth: number
  stage: string
  nReturned?: unknown
  docsExamined?: unknown
  keysExamined?: unknown
  indexName?: string
  keyPattern?: string
}

/** Stage-name → severity bucket for color-coding. */
function stageTone(stage: string): 'bad' | 'good' | 'neutral' {
  const s = stage.toUpperCase()
  if (s === 'COLLSCAN') return 'bad'
  if (s === 'IXSCAN' || s === 'IDHACK') return 'good'
  return 'neutral'
}

/** Render an EJSON key spec ({ a: 1, b: -1 }) into a compact string. */
function keyPatternText(kp: unknown): string | undefined {
  if (!isObj(kp)) return undefined
  const parts = Object.entries(kp).map(([k, v]) => `${k}: ${fmtNum(v) === '—' ? String(v) : toNum(v)}`)
  return parts.length > 0 ? `{ ${parts.join(', ')} }` : undefined
}

/**
 * Walk a stage object recursively, flattening into StageNode[]. Stage objects
 * use `stage` (executionStages) or `stage`/`inputStage` keys.
 */
function walkStages(node: unknown, depth: number, out: StageNode[]): void {
  if (!isObj(node)) return
  const stage = typeof node.stage === 'string' ? node.stage : undefined
  if (stage) {
    out.push({
      depth,
      stage,
      nReturned: node.nReturned,
      docsExamined: node.docsExamined,
      keysExamined: node.keysExamined,
      indexName: typeof node.indexName === 'string' ? node.indexName : undefined,
      keyPattern: keyPatternText(node.keyPattern)
    })
  }
  const childDepth = stage ? depth + 1 : depth
  if (node.inputStage !== undefined) walkStages(node.inputStage, childDepth, out)
  if (Array.isArray(node.inputStages)) {
    for (const child of node.inputStages) walkStages(child, childDepth, out)
  }
  // Sharded explains nest per-shard plans; surface them when present.
  if (Array.isArray(node.shards)) {
    for (const shard of node.shards) {
      if (isObj(shard)) {
        if (isObj(shard.executionStages)) walkStages(shard.executionStages, childDepth, out)
        else if (isObj(shard.winningPlan)) walkStages(shard.winningPlan, childDepth, out)
      }
    }
  }
}

/**
 * Find the index name from the winning plan tree (first IXSCAN encountered).
 */
function findWinningIndex(node: unknown): string | undefined {
  if (!isObj(node)) return undefined
  if (typeof node.indexName === 'string') return node.indexName
  if (node.inputStage !== undefined) {
    const found = findWinningIndex(node.inputStage)
    if (found) return found
  }
  if (Array.isArray(node.inputStages)) {
    for (const child of node.inputStages) {
      const found = findWinningIndex(child)
      if (found) return found
    }
  }
  return undefined
}

interface ParsedExplain {
  execStats?: Dict
  summary: { nReturned?: unknown; docsExamined?: unknown; keysExamined?: unknown; timeMs?: unknown }
  stages: StageNode[]
  winningIndex?: string
}

function parseExplain(plan: unknown): ParsedExplain {
  // `explain` for aggregate may wrap the real plan; tolerate either shape.
  const root = isObj(plan) ? plan : {}
  const execStats = isObj(root.executionStats) ? root.executionStats : undefined
  const queryPlanner = isObj(root.queryPlanner) ? root.queryPlanner : undefined
  const winningPlan = queryPlanner && isObj(queryPlanner.winningPlan) ? queryPlanner.winningPlan : undefined

  const stages: StageNode[] = []
  // Prefer real execution stages; fall back to the planner's winning plan.
  const stageRoot =
    execStats && execStats.executionStages !== undefined ? execStats.executionStages : winningPlan
  walkStages(stageRoot, 0, stages)

  return {
    execStats,
    summary: {
      nReturned: execStats?.nReturned,
      docsExamined: execStats?.totalDocsExamined,
      keysExamined: execStats?.totalKeysExamined,
      timeMs: execStats?.executionTimeMillis
    },
    stages,
    winningIndex: findWinningIndex(winningPlan ?? stageRoot)
  }
}

export function ExplainView({ plan }: ExplainViewProps): JSX.Element {
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
          value={Number.isNaN(toNum(parsed.summary.timeMs)) ? '—' : `${toNum(parsed.summary.timeMs)} ms`}
        />
        <SummaryStat label={t('explain.index')} value={parsed.winningIndex ?? t('explain.none')} mono />
      </div>

      <div className="explain-stages">
        {parsed.stages.length === 0 ? (
          <div className="muted explain-empty">
            {t('explain.noStages')}
          </div>
        ) : (
          parsed.stages.map((node, i) => <StageRow key={i} node={node} />)
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

function SummaryStat({ label, value, mono }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div className="explain-stat">
      <span className="explain-stat-label">{label}</span>
      <span className={mono ? 'explain-stat-value mono' : 'explain-stat-value'}>{value}</span>
    </div>
  )
}

function StageRow({ node }: { node: StageNode }): JSX.Element {
  const { t } = useTranslation()
  const tone = stageTone(node.stage)
  return (
    <div className="explain-stage-row" style={{ paddingLeft: 8 + node.depth * 18 }}>
      <span className={`explain-stage-name tone-${tone}`}>{node.stage}</span>
      <span className="explain-stage-metrics">
        <Metric label={t('explain.metricN')} value={fmtNum(node.nReturned)} />
        {node.docsExamined !== undefined && <Metric label={t('explain.metricDocs')} value={fmtNum(node.docsExamined)} />}
        {node.keysExamined !== undefined && <Metric label={t('explain.metricKeys')} value={fmtNum(node.keysExamined)} />}
        {node.indexName && <span className="explain-stage-index">{node.indexName}</span>}
        {!node.indexName && node.keyPattern && <span className="explain-stage-index">{node.keyPattern}</span>}
      </span>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <span className="explain-metric">
      <span className="explain-metric-label">{label}</span>
      <span className="explain-metric-value">{value}</span>
    </span>
  )
}
