import { describe, expect, it } from 'vitest'
import { previewArrayCell, previewArrayColumns } from '../../../src/renderer/src/lib/previewArray'

function table(value: unknown[]) {
  const columns = previewArrayColumns(value, 'natural')
  return {
    labels: columns.map((column) => column.label),
    rows: value.map((row) => columns.map((column) => {
      const cell = previewArrayCell(row, column)
      return cell.present ? cell.value : 'missing'
    }))
  }
}

describe('array preview mapping', () => {
  it('retains scalar and nested array values alongside object fields', () => {
    expect(table([{ a: 1 }, 2, [3], null, false, undefined])).toEqual({
      labels: ['a', '(value)'],
      rows: [[1, 'missing'], ['missing', 2], ['missing', [3]], ['missing', null], ['missing', false], ['missing', undefined]]
    })
  })

  it('keeps literal value fields separate from the synthetic value column', () => {
    expect(table([{ '(value)': 1, '(value 2)': 2 }, 3])).toEqual({
      labels: ['(value)', '(value 2)', '(value 3)'],
      rows: [[1, 2, 'missing'], ['missing', 'missing', 3]]
    })
  })

  it('treats BSON wrappers as complete scalar values', () => {
    const oid = { $oid: '64b7f0f0f0f0f0f0f0f0f0f0' }
    const date = { $date: { $numberLong: '0' } }
    expect(table([oid, date, { a: 1 }])).toEqual({
      labels: ['a', '(value)'], rows: [['missing', oid], ['missing', date], [1, 'missing']]
    })
  })

  it('preserves field ordering and handles homogeneous and empty arrays', () => {
    expect(previewArrayColumns([{ b: 1, a: 2 }], 'alpha').map((column) => column.label)).toEqual(['a', 'b'])
    expect(table([{ b: 1, a: 2 }])).toEqual({ labels: ['b', 'a'], rows: [[1, 2]] })
    expect(table([1, [2]]).rows).toEqual([[1], [[2]]])
    expect(table([])).toEqual({ labels: [], rows: [] })
    expect(table([{}, 1])).toEqual({ labels: ['(value)'], rows: [['missing'], [1]] })
  })
})
