import { describe, expect, it } from 'vitest'
import { classifyOperationFailure } from '../../../src/main/mongo/errorCore'

describe('classifyOperationFailure', () => {
  it('recognizes driver and server query timeouts', () => {
    expect(classifyOperationFailure({ name: 'MongoOperationTimeoutError' })).toBe('timeout')
    expect(classifyOperationFailure({ code: 50, codeName: 'MaxTimeMSExpired' })).toBe('timeout')
    expect(classifyOperationFailure(new Error('Server selection timed out after 30000 ms'))).toBe('timeout')
  })

  it('distinguishes cancellation, DNS, authentication and network failures', () => {
    expect(classifyOperationFailure({ name: 'AbortError' })).toBe('cancelled')
    expect(classifyOperationFailure({ code: 'ENOTFOUND' })).toBe('dns')
    expect(classifyOperationFailure({ code: 18 })).toBe('auth')
    expect(classifyOperationFailure({ code: 'ECONNRESET' })).toBe('network')
  })

  it('walks causes and uses execution for an unclassified operation error', () => {
    expect(classifyOperationFailure({ cause: { code: 'EAI_AGAIN' } })).toBe('dns')
    expect(classifyOperationFailure(new SyntaxError('bad syntax'))).toBe('execution')
  })

  it('stops when causes contain a cycle', () => {
    const first: { message: string; cause?: unknown } = { message: 'outer failure' }
    const second: { message: string; cause?: unknown } = { message: 'inner failure', cause: first }
    first.cause = second

    expect(classifyOperationFailure(first)).toBe('execution')
  })
})
