import { MongoClient } from 'mongodb'
import type { ConnectionStatus, TestResult } from '../../shared/types'
import { SshTunnel } from '../ssh/tunnel'
import { buildTunnelOptions } from '../ssh/tunnelCore'
import { buildClientArgs, type DecryptedConnection } from './uri'

export interface ConnectionSource {
  getDecrypted(id: string): DecryptedConnection | null
  recordSshHostKey?(id: string, fingerprint: string): void
  recordSshJumpHostKey?(id: string, fingerprint: string): void
}

interface Session {
  client: MongoClient
  tunnel?: SshTunnel
  status: ConnectionStatus
}

interface PendingSession {
  client?: MongoClient
  tunnel?: SshTunnel
}

export const CONNECTION_TEST_TIMEOUT_MS = 30_000

/** Owns all live MongoClient connections and their SSH tunnels. */
export class SessionManager {
  private sessions = new Map<string, Session>()
  private pending = new Map<string, PendingSession>()

  constructor(private readonly connections?: ConnectionSource) {}

  getStatus(id: string): ConnectionStatus {
    if (this.pending.has(id)) return { id, state: 'connecting' }
    return this.sessions.get(id)?.status ?? { id, state: 'disconnected' }
  }

  getClient(id: string): MongoClient {
    const s = this.sessions.get(id)
    if (!s || s.status.state !== 'connected') {
      throw new Error('Connection is not open. Connect first.')
    }
    return s.client
  }

  /** Local forwarded port if this connection runs over an SSH tunnel. */
  getTunnelPort(id: string): number | undefined {
    return this.sessions.get(id)?.tunnel?.localPort
  }

  private async probe(client: MongoClient): Promise<{ topology?: string; serverVersion?: string }> {
    try {
      const admin = client.db('admin')
      const hello = (await admin.command({ hello: 1 })) as Record<string, unknown>
      const build = (await admin.command({ buildInfo: 1 })) as Record<string, unknown>
      const topology = hello.setName ? 'ReplicaSet' : hello.msg === 'isdbgrid' ? 'Sharded' : 'Single'
      return { topology, serverVersion: build.version as string | undefined }
    } catch {
      return {}
    }
  }

  async connect(id: string): Promise<ConnectionStatus> {
    // tear down any existing session for this id first
    await this.disconnect(id)

    const dec = this.connections?.getDecrypted(id)
    if (!dec) {
      const status: ConnectionStatus = {
        id,
        state: 'error',
        error: 'Connection not found'
      }
      return status
    }

    const pending: PendingSession = {}
    this.pending.set(id, pending)
    let tunnel: SshTunnel | undefined
    let client: MongoClient | undefined
    try {
      let tunnelPort: number | undefined
      if (dec.config.ssh.enabled) {
        tunnel = new SshTunnel()
        pending.tunnel = tunnel
        await tunnel.open(buildTunnelOptions(dec))
        if (this.pending.get(id) !== pending) {
          tunnel.close()
          return { id, state: 'disconnected' }
        }
        tunnelPort = tunnel.localPort
      }

      const { uri, options } = buildClientArgs(dec, tunnelPort)
      client = new MongoClient(uri, options)
      pending.client = client
      await client.connect()
      const info = await this.probe(client)

      if (this.pending.get(id) !== pending) {
        await client.close().catch(() => {})
        tunnel?.close()
        return { id, state: 'disconnected' }
      }

      const status: ConnectionStatus = {
        id,
        state: 'connected',
        topology: info.topology,
        serverVersion: info.serverVersion
      }
      this.pending.delete(id)
      this.sessions.set(id, { client, tunnel, status })
      // TOFU: persist the host key(s) learned on first connect so later connects verify them.
      if (tunnel?.learnedHostKey) {
        this.connections?.recordSshHostKey?.(id, tunnel.learnedHostKey)
      }
      if (tunnel?.learnedJumpHostKey) {
        this.connections?.recordSshJumpHostKey?.(id, tunnel.learnedJumpHostKey)
      }
      return status
    } catch (err) {
      const cancelled = this.pending.get(id) !== pending
      if (!cancelled) this.pending.delete(id)
      await client?.close().catch(() => {})
      tunnel?.close()
      if (cancelled) return { id, state: 'disconnected' }
      const status: ConnectionStatus = {
        id,
        state: 'error',
        error: err instanceof Error ? err.message : String(err)
      }
      return status
    }
  }

  async disconnect(id: string): Promise<void> {
    const pending = this.pending.get(id)
    this.pending.delete(id)
    const s = this.sessions.get(id)
    this.sessions.delete(id)
    pending?.tunnel?.close()
    s?.tunnel?.close()
    try {
      await Promise.all([pending?.client?.close(), s?.client.close()])
    } catch {
      /* ignore */
    }
  }

  async test(dec: DecryptedConnection): Promise<TestResult> {
    let tunnel: SshTunnel | undefined
    let client: MongoClient | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    const timeoutError = new Error(`Connection test timed out after ${CONNECTION_TEST_TIMEOUT_MS / 1000} seconds.`)
    const ensureActive = (): void => {
      if (!timedOut) return
      tunnel?.close()
      void client?.close().catch(() => {})
      throw timeoutError
    }
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true
        reject(timeoutError)
        tunnel?.close()
        void client?.close().catch(() => {})
      }, CONNECTION_TEST_TIMEOUT_MS)
      timer.unref()
    })

    try {
      return await Promise.race([
        (async () => {
          let tunnelPort: number | undefined
          if (dec.config.ssh.enabled) {
            tunnel = new SshTunnel()
            tunnelPort = await tunnel.open(buildTunnelOptions(dec))
            ensureActive()
          }
          const { uri, options } = buildClientArgs(dec, tunnelPort)
          client = new MongoClient(uri, options)
          await client.connect()
          ensureActive()
          const info = await this.probe(client)
          ensureActive()
          return {
            ok: true,
            topology: info.topology,
            serverVersion: info.serverVersion
          }
        })(),
        timeout
      ])
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      }
    } finally {
      if (timer) clearTimeout(timer)
      await client?.close().catch(() => {})
      tunnel?.close()
    }
  }

  async closeAll(): Promise<void> {
    const ids = new Set([...this.pending.keys(), ...this.sessions.keys()])
    await Promise.all([...ids].map((id) => this.disconnect(id)))
  }
}
