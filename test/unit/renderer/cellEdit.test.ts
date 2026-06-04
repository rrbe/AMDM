/**
 * Inline cell editing — editability, pre-fill text, and type-preserving coercion.
 * The contract: coerced output keeps the SAME EJSON type as the original, so a
 * $set never silently changes a field's BSON type.
 */
import { describe, it, expect } from 'vitest'
import { isEditableValue, editableText, coerceEdit } from '@renderer/lib/cellEdit'

const OID = '64b7f0f0f0f0f0f0f0f0f0f0'

describe('isEditableValue', () => {
  it('allows scalar leaves', () => {
    expect(isEditableValue('s')).toBe(true)
    expect(isEditableValue(5)).toBe(true)
    expect(isEditableValue(true)).toBe(true)
    expect(isEditableValue(null)).toBe(true)
    expect(isEditableValue({ $oid: OID })).toBe(true)
    expect(isEditableValue({ $date: { $numberLong: '0' } })).toBe(true)
    expect(isEditableValue({ $numberDecimal: '1.5' })).toBe(true)
  })
  it('rejects containers and exotic types', () => {
    expect(isEditableValue({ a: 1 })).toBe(false)
    expect(isEditableValue([1])).toBe(false)
    expect(isEditableValue({ $binary: { base64: '', subType: '00' } })).toBe(false)
    expect(isEditableValue({ $regularExpression: { pattern: 'a', options: '' } })).toBe(false)
    expect(isEditableValue({ $timestamp: { t: 1, i: 1 } })).toBe(false)
    expect(isEditableValue({ $code: 'x' })).toBe(false)
  })
})

describe('editableText pre-fills the editor', () => {
  it('unwraps each editable type to its text', () => {
    expect(editableText('hi')).toBe('hi')
    expect(editableText(true)).toBe('true')
    expect(editableText(5)).toBe('5')
    expect(editableText(null)).toBe('null')
    expect(editableText({ $oid: OID })).toBe(OID)
    expect(editableText({ $numberInt: '42' })).toBe('42')
    expect(editableText({ $numberLong: '123' })).toBe('123')
    expect(editableText({ $numberDouble: '3.5' })).toBe('3.5')
    expect(editableText({ $numberDecimal: '1.50' })).toBe('1.50')
    expect(editableText({ $date: { $numberLong: '1704164645000' } })).toBe('2024-01-02T03:04:05.000Z')
    expect(editableText({ $date: '2024-01-02T03:04:05.000Z' })).toBe('2024-01-02T03:04:05.000Z')
  })
  it('returns null for non-editable values', () => {
    expect(editableText({ $binary: { base64: '', subType: '00' } })).toBeNull()
    expect(editableText([1])).toBeNull()
  })
})

describe('coerceEdit preserves type or reports a typed error', () => {
  it('string keeps raw text (including surrounding spaces)', () => {
    expect(coerceEdit('a', '  b  ')).toEqual({ value: '  b  ' })
  })
  it('boolean', () => {
    expect(coerceEdit(true, 'false')).toEqual({ value: false })
    expect(coerceEdit(true, 'nope')).toEqual({ error: '请输入 true 或 false' })
  })
  it('null: literal null vs fallback string', () => {
    expect(coerceEdit(null, 'null')).toEqual({ value: null })
    expect(coerceEdit(null, 'other')).toEqual({ value: 'other' })
  })
  it('number', () => {
    expect(coerceEdit(1, '3.5')).toEqual({ value: 3.5 })
    expect(coerceEdit(1, 'x')).toEqual({ error: '不是合法数字' })
  })
  it('double stays a $numberDouble', () => {
    expect(coerceEdit({ $numberDouble: '1.0' }, '2.5')).toEqual({ value: { $numberDouble: '2.5' } })
    expect(coerceEdit({ $numberDouble: '1.0' }, 'x')).toEqual({ error: '不是合法数字' })
  })
  it('int rejects non-integers', () => {
    expect(coerceEdit({ $numberInt: '1' }, '7')).toEqual({ value: { $numberInt: '7' } })
    expect(coerceEdit({ $numberInt: '1' }, '7.5')).toEqual({ error: '不是合法整数' })
  })
  it('long requires a plain integer string', () => {
    expect(coerceEdit({ $numberLong: '1' }, '9007199254740993')).toEqual({
      value: { $numberLong: '9007199254740993' }
    })
    expect(coerceEdit({ $numberLong: '1' }, '1.5')).toEqual({ error: '不是合法整数' })
    expect(coerceEdit({ $numberLong: '1' }, '12a')).toEqual({ error: '不是合法整数' })
  })
  it('decimal accepts scientific notation', () => {
    expect(coerceEdit({ $numberDecimal: '1.0' }, '1.5e3')).toEqual({
      value: { $numberDecimal: '1.5e3' }
    })
    expect(coerceEdit({ $numberDecimal: '1.0' }, 'abc')).toEqual({ error: '不是合法小数' })
  })
  it('objectId requires 24 hex chars', () => {
    expect(coerceEdit({ $oid: OID }, OID)).toEqual({ value: { $oid: OID } })
    expect(coerceEdit({ $oid: OID }, 'xyz')).toEqual({ error: 'ObjectId 必须是 24 位十六进制' })
  })
  it('date normalizes to an ISO $date or errors', () => {
    expect(coerceEdit({ $date: { $numberLong: '0' } }, '2024-01-02T03:04:05.000Z')).toEqual({
      value: { $date: '2024-01-02T03:04:05.000Z' }
    })
    expect(coerceEdit({ $date: { $numberLong: '0' } }, 'not a date')).toEqual({
      error: '不是合法日期'
    })
  })
})
