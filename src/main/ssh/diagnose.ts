/**
 * Network connectivity probe for the SSH tunnel path. A plain TCP dial that
 * fails fast (and clearly) when the entry hop is unreachable, so a *network*
 * problem is distinguishable from an SSH *auth* / *host-key* problem — and from
 * the 20s ssh2 readyTimeout that a filtered host would otherwise incur.
 */
import net from 'node:net'
import { classifyConnError } from './tunnelCore'

export const PROBE_TIMEOUT_MS = 8000

/**
 * Resolve if a TCP connection to host:port succeeds; reject with a clear,
 * classified message ("Cannot reach host:port — …") otherwise.
 */
export function tcpProbe(host: string, port: number, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    let settled = false
    const fail = (message: string): void => {
      if (settled) return
      settled = true
      socket.destroy()
      reject(new Error(`Cannot reach ${host}:${port} — ${message}`))
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve()
    })
    socket.once('timeout', () =>
      fail('connection timed out — the host is unreachable or the port is filtered')
    )
    socket.once('error', (err) => fail(classifyConnError(err).message))
    socket.connect(port, host)
  })
}
