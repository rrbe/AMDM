/**
 * Pure parser for an `explain('executionStats')` document (EJSON-canonical plain
 * object) → a nested stage tree + summary, for the graphical ExplainView.
 *
 * Explain shapes vary a lot (find vs aggregate vs sharded vs server version), so
 * every extraction is defensive: we surface whatever we can find and never
 * throw. The component renders `roots` as connected boxes; unknown shapes yield
 * an empty tree and fall back to the raw JSON.
 */

type Dict = Record<string, unknown>

export type StageTone = 'bad' | 'good' | 'neutral'

/** One node in the execution-stage tree; `children` are its `inputStage(s)`. */
export interface StageTreeNode {
  stage: string
  tone: StageTone
  nReturned?: number
  docsExamined?: number
  keysExamined?: number
  /** Per-stage `executionTimeMillisEstimate`, when present. */
  timeMs?: number
  indexName?: string
  keyPattern?: string
  children: StageTreeNode[]
}

export interface ExplainSummary {
  nReturned?: number
  docsExamined?: number
  keysExamined?: number
  timeMs?: number
}

export interface ParsedExplain {
  summary: ExplainSummary
  roots: StageTreeNode[]
  winningIndex?: string
}

function isObj(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Coerce an EJSON-wrapped or plain number to a JS number (NaN on failure). */
export function toNum(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') return Number(v)
  if (isObj(v)) {
    for (const k of ['$numberInt', '$numberLong', '$numberDouble', '$numberDecimal']) {
      if (k in v) return Number(v[k])
    }
  }
  return NaN
}

function numOrUndef(v: unknown): number | undefined {
  const n = toNum(v)
  return Number.isNaN(n) ? undefined : n
}

/** Stage-name → severity bucket for color-coding. */
export function stageTone(stage: string): StageTone {
  const s = stage.toUpperCase()
  if (s === 'COLLSCAN') return 'bad'
  if (s === 'IXSCAN' || s === 'IDHACK') return 'good'
  return 'neutral'
}

/** Render an EJSON key spec ({ a: 1, b: -1 }) into a compact string. */
function keyPatternText(kp: unknown): string | undefined {
  if (!isObj(kp)) return undefined
  const parts = Object.entries(kp).map(([k, v]) => {
    const n = toNum(v)
    return `${k}: ${Number.isNaN(n) ? String(v) : n}`
  })
  return parts.length > 0 ? `{ ${parts.join(', ')} }` : undefined
}

/**
 * Build the nested stage tree from a stage object, following `inputStage`
 * (single), `inputStages` (array), and sharded `shards[]`. A node without its
 * own `stage` name is treated as a pass-through wrapper — its children bubble up
 * — so we never render an anonymous box.
 */
function buildNodes(node: unknown): StageTreeNode[] {
  if (!isObj(node)) return []

  const children: StageTreeNode[] = []
  if (node.inputStage !== undefined) children.push(...buildNodes(node.inputStage))
  if (Array.isArray(node.inputStages)) {
    for (const child of node.inputStages) children.push(...buildNodes(child))
  }
  if (Array.isArray(node.shards)) {
    for (const shard of node.shards) {
      if (!isObj(shard)) continue
      if (isObj(shard.executionStages)) children.push(...buildNodes(shard.executionStages))
      else if (isObj(shard.winningPlan)) children.push(...buildNodes(shard.winningPlan))
    }
  }

  const stage = typeof node.stage === 'string' ? node.stage : undefined
  if (!stage) return children // pass-through: surface children directly

  return [
    {
      stage,
      tone: stageTone(stage),
      nReturned: numOrUndef(node.nReturned),
      docsExamined: numOrUndef(node.docsExamined),
      keysExamined: numOrUndef(node.keysExamined),
      timeMs: numOrUndef(node.executionTimeMillisEstimate),
      indexName: typeof node.indexName === 'string' ? node.indexName : undefined,
      keyPattern: keyPatternText(node.keyPattern),
      children
    }
  ]
}

/** First index name found in the winning plan tree. */
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

export function parseExplain(plan: unknown): ParsedExplain {
  const root = isObj(plan) ? plan : {}
  const execStats = isObj(root.executionStats) ? root.executionStats : undefined
  const queryPlanner = isObj(root.queryPlanner) ? root.queryPlanner : undefined
  const winningPlan =
    queryPlanner && isObj(queryPlanner.winningPlan) ? queryPlanner.winningPlan : undefined

  // Prefer real execution stages; fall back to the planner's winning plan.
  const stageRoot =
    execStats && execStats.executionStages !== undefined ? execStats.executionStages : winningPlan

  return {
    summary: {
      nReturned: numOrUndef(execStats?.nReturned),
      docsExamined: numOrUndef(execStats?.totalDocsExamined),
      keysExamined: numOrUndef(execStats?.totalKeysExamined),
      timeMs: numOrUndef(execStats?.executionTimeMillis)
    },
    roots: buildNodes(stageRoot),
    winningIndex: findWinningIndex(winningPlan ?? stageRoot)
  }
}
