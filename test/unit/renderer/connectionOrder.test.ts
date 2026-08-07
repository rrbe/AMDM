import { describe, expect, it } from 'vitest'
import type { ConnectionConfig } from '../../../src/shared/types'
import {
  applyConnectionOrder,
  reorderConnectionIds
} from '../../../src/renderer/src/lib/connectionOrder'

const connection = (id: string): ConnectionConfig =>
  ({ id, name: id } as ConnectionConfig)

describe('connection ordering', () => {
  it('applies saved ids and appends new connections', () => {
    const connections = ['a', 'b', 'c'].map(connection)
    expect(applyConnectionOrder(connections, ['b', 'missing', 'a']).map((item) => item.id)).toEqual([
      'b',
      'a',
      'c'
    ])
  })

  it('accepts settings loaded before connection ordering existed', () => {
    const connections = ['a', 'b'].map(connection)
    expect(applyConnectionOrder(connections, undefined)).toEqual(connections)
  })

  it('moves a connection before or after the drop target', () => {
    expect(reorderConnectionIds(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a'])
    expect(reorderConnectionIds(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b'])
  })

  it('keeps the same array when the drop does not change the order', () => {
    const ids = ['a', 'b', 'c']
    expect(reorderConnectionIds(ids, 'b', 'a', 'after')).toBe(ids)
  })
})
