/**
 * Pure part of the doc-mutation core: _id deserialization. (The driver ops are
 * covered in test/integration/docOps.test.ts.)
 */
import { describe, it, expect } from 'vitest'
import { ObjectId, Long } from 'bson'
import { deserializeId } from '../../../src/main/mongo/docOpsCore'

describe('deserializeId', () => {
  it('turns an EJSON {$oid} into an ObjectId', () => {
    const id = deserializeId({ $oid: '64b7f0f0f0f0f0f0f0f0f0f0' })
    expect(id).toBeInstanceOf(ObjectId)
    expect((id as ObjectId).toHexString()).toBe('64b7f0f0f0f0f0f0f0f0f0f0')
  })
  it('turns an EJSON {$numberLong} into a Long', () => {
    expect(deserializeId({ $numberLong: '42' })).toBeInstanceOf(Long)
  })
  it('preserves a large NumberLong _id without precision loss (regression)', () => {
    // EJSON.deserialize would promote this to a lossy JS number (…776000),
    // making the filter miss the real document.
    const id = deserializeId({ $numberLong: '9223372036854775807' })
    expect(id).toBeInstanceOf(Long)
    expect(String(id)).toBe('9223372036854775807')
  })
  it('passes plain string/number/null _id through unchanged', () => {
    expect(deserializeId('abc')).toBe('abc')
    expect(deserializeId(5)).toBe(5)
    expect(deserializeId(null)).toBeNull()
  })
})
