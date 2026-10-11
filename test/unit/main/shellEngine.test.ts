import { describe, expect, it, vi } from 'vitest'
import type { ShellRequest } from '../../../src/shared/types'

vi.mock('../../../src/main/mongo/sessionManager', () => ({
  sessionManager: { getClient: vi.fn(() => client) }
}))
vi.mock('../../../src/main/mongo/mongoshCore', () => ({ runMongoshOnClient: vi.fn() }))

import { runMongoshOnClient } from '../../../src/main/mongo/mongoshCore'
import { executeShell } from '../../../src/main/mongo/shellEngine'

const client = {}

describe('query execution', () => {
  it.each([undefined, 'legacy', 'mongosh'])('always uses Mongosh with stored runtime %s', async (runtime) => {
    vi.mocked(runMongoshOnClient).mockResolvedValue({ kind: 'value', data: 42 })
    const request = { connectionId: 'c', database: 'test', code: '42', runtime } as ShellRequest
    await expect(executeShell(request)).resolves.toMatchObject({ kind: 'value', data: 42 })
    expect(runMongoshOnClient).toHaveBeenLastCalledWith(client, '42', expect.objectContaining({ database: 'test' }))
  })
})
