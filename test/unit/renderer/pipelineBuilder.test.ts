/**
 * Pure pipeline-builder logic: stage CRUD (immutable), operator-change body
 * reset heuristic, and aggregate/preview code assembly (text concatenation that
 * preserves shell constructors, skips disabled/empty stages).
 */
import { describe, it, expect } from 'vitest'
import {
  createStage,
  defaultBody,
  addStage,
  removeStage,
  toggleStage,
  setStageBody,
  setStageOp,
  moveStage,
  buildPipelineText,
  buildAggregateCode,
  buildPreviewCode,
  type AggregationStage
} from '../../../src/renderer/src/lib/pipelineBuilder'

const stage = (id: string, op: string, body: string, enabled = true): AggregationStage => ({
  id,
  op,
  body,
  enabled
})

describe('stage CRUD', () => {
  it('creates a stage with the operator starter body', () => {
    const s = createStage('a', '$limit')
    expect(s).toEqual({ id: 'a', op: '$limit', body: defaultBody('$limit'), enabled: true })
  })

  it('adds, removes, and toggles immutably', () => {
    const a = createStage('a')
    const list = addStage([], a)
    expect(list).toEqual([a])
    expect(list).not.toBe([]) // new array

    expect(toggleStage(list, 'a')[0].enabled).toBe(false)
    expect(list[0].enabled).toBe(true) // original untouched

    expect(removeStage(list, 'a')).toEqual([])
  })

  it('sets a stage body without touching siblings', () => {
    const list = [stage('a', '$match', '{}'), stage('b', '$limit', '5')]
    const next = setStageBody(list, 'a', '{ x: 1 }')
    expect(next[0].body).toBe('{ x: 1 }')
    expect(next[1]).toBe(list[1]) // sibling identity preserved
  })

  it('swaps in the new starter on op change only when body is the untouched starter', () => {
    const pristine = [createStage('a', '$match')]
    expect(setStageOp(pristine, 'a', '$limit')[0].body).toBe(defaultBody('$limit'))

    const edited = [stage('a', '$match', '{ status: "x" }')]
    expect(setStageOp(edited, 'a', '$limit')[0].body).toBe('{ status: "x" }') // kept
    expect(setStageOp(edited, 'a', '$limit')[0].op).toBe('$limit')
  })

  it('moves a stage and no-ops on bad indices', () => {
    const list = [stage('a', '$match', '{}'), stage('b', '$sort', '{}'), stage('c', '$limit', '1')]
    expect(moveStage(list, 0, 2).map((s) => s.id)).toEqual(['b', 'c', 'a'])
    expect(moveStage(list, 1, 1)).toBe(list) // no-op same index
    expect(moveStage(list, 0, 9)).toBe(list) // no-op out of range
  })
})

describe('code generation', () => {
  it('builds an aggregate over enabled, non-empty stages', () => {
    const list = [
      stage('a', '$match', '{ status: "active" }'),
      stage('b', '$group', '{ _id: "$city", n: { $sum: 1 } }')
    ]
    expect(buildAggregateCode('orders', list)).toBe(
      'db.orders.aggregate([\n' +
        '  { $match: { status: "active" } },\n' +
        '  { $group: { _id: "$city", n: { $sum: 1 } } }\n' +
        '])'
    )
  })

  it('skips disabled and empty stages', () => {
    const list = [
      stage('a', '$match', '{ x: 1 }'),
      stage('b', '$sort', '{ x: 1 }', false), // disabled
      stage('c', '$limit', '   ') // empty body
    ]
    expect(buildPipelineText(list)).toBe('[\n  { $match: { x: 1 } }\n]')
  })

  it('renders an empty pipeline when nothing is active', () => {
    expect(buildPipelineText([])).toBe('[]')
    expect(buildAggregateCode('c', [])).toBe('db.c.aggregate([])')
  })

  it('preserves shell constructors verbatim (no JSON.parse)', () => {
    const list = [stage('a', '$match', '{ _id: ObjectId("64aa") }')]
    expect(buildAggregateCode('c', list)).toContain('ObjectId("64aa")')
  })

  it('uses getCollection() for non-identifier collection names', () => {
    expect(buildAggregateCode('weird-name.x', [stage('a', '$limit', '1')])).toContain(
      'db.getCollection("weird-name.x").aggregate('
    )
  })

  it('uses getCollection() for names that collide with db members', () => {
    for (const name of ['admin', 'collection', 'aggregate', 'getCollection', 'stats']) {
      expect(buildAggregateCode(name, [stage('a', '$limit', '1')])).toContain(
        `db.getCollection("${name}").aggregate(`
      )
    }
    // plain names are still unquoted
    expect(buildAggregateCode('orders', [stage('a', '$limit', '1')])).toContain('db.orders.aggregate(')
  })

  it('previews the pipeline truncated through a stage index (inclusive)', () => {
    const list = [
      stage('a', '$match', '{ x: 1 }'),
      stage('b', '$group', '{ _id: 1 }'),
      stage('c', '$sort', '{ x: 1 }')
    ]
    const code = buildPreviewCode('c', list, 1)
    expect(code).toContain('$match')
    expect(code).toContain('$group')
    expect(code).not.toContain('$sort') // stage c excluded
  })

  it('never includes write stages ($out/$merge) in a preview', () => {
    const list = [stage('a', '$match', '{ x: 1 }'), stage('b', '$out', '"archive"')]
    // Previewing the $out stage itself must not generate a write.
    const code = buildPreviewCode('c', list, 1)
    expect(code).toContain('$match')
    expect(code).not.toContain('$out')
    // But the real (apply) code keeps it.
    expect(buildAggregateCode('c', list)).toContain('$out')
  })
})
