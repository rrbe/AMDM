/**
 * TCP reachability probe used as the SSH tunnel's network pre-check.
 */
import net from 'node:net'
import { describe, it, expect } from 'vitest'
import { tcpProbe } from '../../../src/main/ssh/diagnose'

function listen(): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo
      resolve({ port: addr.port, close: () => server.close() })
    })
  })
}

describe('tcpProbe', () => {
  it('resolves when the port is open', async () => {
    const s = await listen()
    await expect(tcpProbe('127.0.0.1', s.port, 2000)).resolves.toBeUndefined()
    s.close()
  })

  it('rejects with a clear "Cannot reach" message when the port is closed', async () => {
    const s = await listen()
    const port = s.port
    s.close() // release the port → connection refused
    await expect(tcpProbe('127.0.0.1', port, 2000)).rejects.toThrow(/Cannot reach 127\.0\.0\.1:\d+ —/)
  })
})
