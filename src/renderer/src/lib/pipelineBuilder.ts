/**
 * Pure logic for the aggregation pipeline builder (no React, no store) so it's
 * unit-testable. Each stage holds the raw *text* of one aggregation operator's
 * value; the builder assembles those into a `db.<coll>.aggregate([...])` string
 * by text concatenation — never JSON.parse — so shell constructors like
 * `ObjectId(...)` / `ISODate(...)` survive into the generated code untouched.
 */

export interface AggregationStage {
  id: string
  /** Operator key, e.g. '$match'. */
  op: string
  /** Raw text of the operator's value, e.g. '{ status: "active" }' or '10'. */
  body: string
  /** Disabled stages are kept (so they can be toggled back) but skipped in the
      generated pipeline and previews. */
  enabled: boolean
}

export interface PipelineBuilderState {
  /** Whether the side panel is shown for this tab. */
  open: boolean
  /** Target collection the pipeline runs against. */
  collection: string
  stages: AggregationStage[]
}

/** A common pipeline operator plus the starter body inserted when it's added. */
export interface StageOpDef {
  op: string
  template: string
}

/** The operators offered in the stage type dropdown, with sensible starters. */
export const STAGE_OPS: StageOpDef[] = [
  { op: '$match', template: '{\n  \n}' },
  { op: '$group', template: '{\n  _id: null\n}' },
  { op: '$project', template: '{\n  \n}' },
  { op: '$sort', template: '{\n  \n}' },
  { op: '$limit', template: '10' },
  { op: '$skip', template: '0' },
  { op: '$count', template: '"count"' },
  { op: '$unwind', template: '"$"' },
  { op: '$addFields', template: '{\n  \n}' },
  { op: '$set', template: '{\n  \n}' },
  { op: '$unset', template: '""' },
  { op: '$lookup', template: '{\n  from: "",\n  localField: "",\n  foreignField: "",\n  as: ""\n}' },
  { op: '$sortByCount', template: '"$"' },
  { op: '$replaceRoot', template: '{\n  newRoot: ""\n}' },
  { op: '$facet', template: '{\n  \n}' },
  { op: '$sample', template: '{\n  size: 10\n}' },
  { op: '$out', template: '""' },
  { op: '$merge', template: '{\n  into: ""\n}' }
]

const DEFAULT_OP = '$match'

/** Stages that WRITE to the database (terminal). A preview must never run these
    — `limit` bounds only the client cursor, not the server-side write. */
const WRITE_STAGES = new Set(['$out', '$merge'])

/** True for stages that persist to a collection ($out / $merge). */
export function isWriteStage(op: string): boolean {
  return WRITE_STAGES.has(op)
}

/** Starter body for an operator (empty object when unknown). */
export function defaultBody(op: string): string {
  return STAGE_OPS.find((s) => s.op === op)?.template ?? '{\n  \n}'
}

/** A fresh stage; `id` is injected so callers control id generation. */
export function createStage(id: string, op: string = DEFAULT_OP): AggregationStage {
  return { id, op, body: defaultBody(op), enabled: true }
}

// --- immutable stage-list operations (all return a new array) ---

export function addStage(stages: AggregationStage[], stage: AggregationStage): AggregationStage[] {
  return [...stages, stage]
}

export function removeStage(stages: AggregationStage[], id: string): AggregationStage[] {
  return stages.filter((s) => s.id !== id)
}

export function toggleStage(stages: AggregationStage[], id: string): AggregationStage[] {
  return stages.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
}

export function setStageBody(stages: AggregationStage[], id: string, body: string): AggregationStage[] {
  return stages.map((s) => (s.id === id ? { ...s, body } : s))
}

/** Change a stage's operator. If its body is still the previous operator's
    untouched starter, swap in the new operator's starter too (so picking a type
    before typing gives a useful template); otherwise the user's body is kept. */
export function setStageOp(stages: AggregationStage[], id: string, op: string): AggregationStage[] {
  return stages.map((s) => {
    if (s.id !== id) return s
    const body = s.body.trim() === defaultBody(s.op).trim() ? defaultBody(op) : s.body
    return { ...s, op, body }
  })
}

/** Move the stage at `from` to index `to` (clamped no-op on bad indices). */
export function moveStage(stages: AggregationStage[], from: number, to: number): AggregationStage[] {
  if (from === to || from < 0 || to < 0 || from >= stages.length || to >= stages.length) return stages
  const next = [...stages]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

// --- code generation (text assembly, never JSON.parse) ---

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

/** `db.orders` for a plain name, else `db.getCollection("…")` for odd names. */
function dbCollRef(coll: string): string {
  return IDENTIFIER.test(coll) ? `db.${coll}` : `db.getCollection(${JSON.stringify(coll)})`
}

/** Re-indent continuation lines of a body so they align under the operator. */
function indentBody(body: string, pad: string): string {
  return body
    .split('\n')
    .map((line, i) => (i === 0 ? line : pad + line))
    .join('\n')
}

/** Assemble the enabled, non-empty stages into a pipeline array literal. */
export function buildPipelineText(stages: AggregationStage[]): string {
  const active = stages.filter((s) => s.enabled && s.body.trim() !== '')
  if (active.length === 0) return '[]'
  const items = active.map((s) => {
    const head = `  { ${s.op}: `
    return `${head}${indentBody(s.body.trim(), ' '.repeat(head.length))} }`
  })
  return `[\n${items.join(',\n')}\n]`
}

/** Full `db.<coll>.aggregate([...])` for the (enabled) stages. */
export function buildAggregateCode(collection: string, stages: AggregationStage[]): string {
  return `${dbCollRef(collection)}.aggregate(${buildPipelineText(stages)})`
}

/**
 * Aggregate code for a per-stage preview: the pipeline truncated through
 * `uptoIndex` (inclusive), with **write stages ($out/$merge) stripped** — a
 * "preview" must be read-only (`limit` bounds only the client cursor, not a
 * server-side write), so a write stage at or before the cursor previews the
 * data that *would* be written, never performing the write. No `.toArray()`:
 * the shell engine bounds the aggregation cursor to a page on its own.
 */
export function buildPreviewCode(
  collection: string,
  stages: AggregationStage[],
  uptoIndex: number
): string {
  const readOnly = stages.slice(0, uptoIndex + 1).filter((s) => !isWriteStage(s.op))
  return buildAggregateCode(collection, readOnly)
}
