/**
 * Data-contract round-trip (the cross-layer backstop).
 *
 * One shared corpus (fixtures/bson-corpus.ts) is pushed through every layer that
 * touches the BSON↔EJSON wire format:
 *
 *   real BSON ──serialize-core──▶ EJSON-canonical ──ejson.ts──▶ display/type
 *                                        │
 *                                        └────resultCopy.ts────▶ plain / strict
 *
 * If ANY layer drifts (a new BSON type added to serialize-core but not ejson.ts,
 * a display string changed, a precision-preserving collapse broken), a case here
 * goes red. This turns the "新增 BSON 类型要同时改 core 和 ejson.ts" convention
 * into an automatic check.
 */
import { describe, it, expect } from 'vitest'
import { EJSON } from 'bson'
import { serializeValue } from '../../src/main/workers/serialize-core'
import { formatScalar, valueType, isExpandable } from '../../src/renderer/src/lib/ejson'
import { toPlainValue, toStrictEjson } from '../../src/renderer/src/lib/resultCopy'
import {
  SCALAR_CASES,
  SAMPLE_DOC_VALUE,
  SAMPLE_DOC_EJSON
} from '../fixtures/bson-corpus'

describe('BSON → EJSON-canonical (serialize-core layer)', () => {
  for (const c of SCALAR_CASES) {
    it(`${c.name}: serializeValue emits the canonical wire form`, () => {
      expect(serializeValue(c.value)).toEqual(c.ejson)
    })
  }

  it('whole document serializes to the expected canonical shape', () => {
    expect(serializeValue(SAMPLE_DOC_VALUE)).toEqual(SAMPLE_DOC_EJSON)
  })
})

describe('EJSON-canonical → display/type (ejson.ts layer)', () => {
  for (const c of SCALAR_CASES) {
    it(`${c.name}: formatScalar/valueType match, leaf is not expandable`, () => {
      const s = formatScalar(c.ejson)
      expect(s.text).toBe(c.display)
      expect(s.type).toBe(c.type)
      expect(valueType(c.ejson)).toBe(c.type)
      expect(isExpandable(c.ejson)).toBe(false)
    })
  }
})

describe('EJSON-canonical → plain (resultCopy.ts layer)', () => {
  for (const c of SCALAR_CASES) {
    it(`${c.name}: toPlainValue collapses to the expected plain value`, () => {
      expect(toPlainValue(c.ejson)).toEqual(c.plain)
    })
  }

  it('whole document collapses recursively, preserving structure', () => {
    expect(toPlainValue(SAMPLE_DOC_EJSON)).toEqual({
      _id: '64b7f0f0f0f0f0f0f0f0f0f0',
      n: 7,
      tags: ['a', 'b'],
      nested: { city: 'x' }
    })
  })
})

describe('strict EJSON is round-trippable by the driver', () => {
  // toStrictEjson is the canonical wrapper as-is; parsing it back (with
  // canonical fidelity, as the driver does — relaxed:false keeps $numberLong a
  // Long instead of a lossy JS number) and re-serializing must reproduce the
  // exact same wire form.
  const reserialize = (ejson: unknown): unknown =>
    serializeValue(EJSON.parse(toStrictEjson(ejson), { relaxed: false }))

  for (const c of SCALAR_CASES) {
    it(`${c.name}: parse(strict) → serialize reproduces the canonical form`, () => {
      expect(reserialize(c.ejson)).toEqual(c.ejson)
    })
  }

  it('whole document round-trips through strict EJSON', () => {
    expect(reserialize(SAMPLE_DOC_EJSON)).toEqual(SAMPLE_DOC_EJSON)
  })
})
