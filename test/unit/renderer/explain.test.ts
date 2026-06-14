/**
 * Pure explain parser: nested stage tree + summary + winning index, across the
 * shapes the UI must tolerate (find IXSCAN chain, COLLSCAN, branching
 * inputStages, EJSON-wrapped numbers, garbage).
 */
import { describe, it, expect } from 'vitest'
import { parseExplain, stageTone, toNum } from '../../../src/renderer/src/lib/explain'

describe('stageTone', () => {
  it('flags COLLSCAN bad, index scans good, others neutral', () => {
    expect(stageTone('COLLSCAN')).toBe('bad')
    expect(stageTone('IXSCAN')).toBe('good')
    expect(stageTone('IDHACK')).toBe('good')
    expect(stageTone('FETCH')).toBe('neutral')
    expect(stageTone('limit')).toBe('neutral')
  })
})

describe('toNum', () => {
  it('coerces plain, string, and EJSON-wrapped numbers', () => {
    expect(toNum(5)).toBe(5)
    expect(toNum('7')).toBe(7)
    expect(toNum({ $numberInt: '42' })).toBe(42)
    expect(toNum({ $numberLong: '900' })).toBe(900)
    expect(Number.isNaN(toNum({}))).toBe(true)
  })
})

describe('parseExplain', () => {
  const findPlan = {
    queryPlanner: {
      winningPlan: {
        stage: 'LIMIT',
        inputStage: {
          stage: 'FETCH',
          inputStage: { stage: 'IXSCAN', indexName: 'a_1', keyPattern: { a: 1 } }
        }
      }
    },
    executionStats: {
      nReturned: 5,
      totalDocsExamined: 5,
      totalKeysExamined: 5,
      executionTimeMillis: 2,
      executionStages: {
        stage: 'LIMIT',
        nReturned: 5,
        executionTimeMillisEstimate: 1,
        inputStage: {
          stage: 'FETCH',
          nReturned: 5,
          docsExamined: 5,
          inputStage: {
            stage: 'IXSCAN',
            nReturned: 5,
            keysExamined: 5,
            indexName: 'a_1',
            keyPattern: { a: 1 }
          }
        }
      }
    }
  }

  it('builds a nested tree from execution stages and reads the summary', () => {
    const parsed = parseExplain(findPlan)
    expect(parsed.summary).toEqual({ nReturned: 5, docsExamined: 5, keysExamined: 5, timeMs: 2 })
    expect(parsed.winningIndex).toBe('a_1')

    expect(parsed.roots).toHaveLength(1)
    const limit = parsed.roots[0]
    expect(limit.stage).toBe('LIMIT')
    expect(limit.tone).toBe('neutral')
    expect(limit.timeMs).toBe(1)

    const fetch = limit.children[0]
    expect(fetch.stage).toBe('FETCH')
    expect(fetch.docsExamined).toBe(5)

    const ixscan = fetch.children[0]
    expect(ixscan.stage).toBe('IXSCAN')
    expect(ixscan.tone).toBe('good')
    expect(ixscan.indexName).toBe('a_1')
    expect(ixscan.keyPattern).toBe('{ a: 1 }')
    expect(ixscan.children).toEqual([])
  })

  it('marks a COLLSCAN as bad and finds no index', () => {
    const parsed = parseExplain({ queryPlanner: { winningPlan: { stage: 'COLLSCAN' } } })
    expect(parsed.roots).toHaveLength(1)
    expect(parsed.roots[0].stage).toBe('COLLSCAN')
    expect(parsed.roots[0].tone).toBe('bad')
    expect(parsed.winningIndex).toBeUndefined()
  })

  it('branches on inputStages (e.g. OR / MERGE_SORT)', () => {
    const parsed = parseExplain({
      queryPlanner: {
        winningPlan: {
          stage: 'OR',
          inputStages: [
            { stage: 'IXSCAN', indexName: 'a_1' },
            { stage: 'IXSCAN', indexName: 'b_1' }
          ]
        }
      }
    })
    const or = parsed.roots[0]
    expect(or.stage).toBe('OR')
    expect(or.children.map((c) => c.stage)).toEqual(['IXSCAN', 'IXSCAN'])
    expect(or.children.map((c) => c.indexName)).toEqual(['a_1', 'b_1'])
  })

  it('reads EJSON-wrapped metric numbers', () => {
    const parsed = parseExplain({
      executionStats: {
        nReturned: { $numberInt: '3' },
        totalDocsExamined: { $numberLong: '10' },
        executionStages: { stage: 'COLLSCAN', nReturned: { $numberInt: '3' } }
      }
    })
    expect(parsed.summary.nReturned).toBe(3)
    expect(parsed.summary.docsExamined).toBe(10)
    expect(parsed.summary.keysExamined).toBeUndefined()
  })

  it('returns an empty tree for garbage input without throwing', () => {
    expect(parseExplain(null).roots).toEqual([])
    expect(parseExplain(undefined).roots).toEqual([])
    expect(parseExplain('nope').roots).toEqual([])
    expect(parseExplain(42).summary).toEqual({
      nReturned: undefined,
      docsExamined: undefined,
      keysExamined: undefined,
      timeMs: undefined
    })
  })
})
