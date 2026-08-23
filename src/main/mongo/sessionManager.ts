import { MongoClient, type TopologyDescriptionChangedEvent } from 'mongodb'
import type { ConnectionStatus, FailureKind, TestResult } from '../../shared/types'
import { connectionStore } from '../store/connectionStore'
import { SshTunnel } from '../ssh/tunnel'
import { buildTunnelOptions, classifyConnError } from '../ssh/tunnelCore'
import { buildClientArgs, type DecryptedConnection } from './uri'
import { classifyOperationFailure } from './errorCore'

function classifyConnectionFailure(error: unknown): FailureKind {
  const connectionKind = classifyConnError(error).kind
  if (connectionKind !== 'other') return connectionKind
  const operationKind = classifyOperationFailure(error)
  return operationKind === 'execution' ? 'unknown' : operationKind
}

interface Session {
  client: MongoClient
  tunnel?: SshTunnel
  status: ConnectionStatus
  stopMonitoring: () => void
}

interface PendingSession {
  client?: MongoClient
  tunnel?: SshTunnel
}

/** Owns all live MongoClient connections and their SSH tunnels. */
export class SessionManager {
  private sessions = new Map<string, Session>()
  private pending = new Map<string, PendingSession>()
  private statusListeners = new Set<(status: ConnectionStatus) => void>()

  onStatusChanged(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  private publishStatus(status: ConnectionStatus): void {
    for (const listener of this.statusListeners) {
      try {
        listener(status)
      } catch (error) {
        console.error('[session status listener]', error)
      }
    }
  }

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

    const dec = connectionStore.getDecrypted(id)
    if (!dec) {
      const status: ConnectionStatus = {
        id,
        state: 'error',
        error: 'Connection not found',
        failureKind: 'unknown'
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
      const connectedClient = new MongoClient(uri, options)
      client = connectedClient
      pending.client = connectedClient
      await connectedClient.connect()
      const info = await this.probe(connectedClient)

      if (this.pending.get(id) !== pending) {
        await connectedClient.close().catch(() => {})
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
      const session: Session = { client: connectedClient, tunnel, status, stopMonitoring: () => {} }
      const onTopologyChanged = (event: TopologyDescriptionChangedEvent): void => {
        if (this.sessions.get(id) !== session) return
        const available = event.newDescription.hasKnownServers
        if (available === (session.status.state === 'connected')) return

        const topologyError = event.newDescription.error
        session.status = available
          ? {
              id,
              state: 'connected',
              topology: event.newDescription.type,
              serverVersion: status.serverVersion
            }
          : {
              id,
              state: 'error',
              error: topologyError?.message ?? 'Connection lost',
              failureKind: classifyConnectionFailure(topologyError),
              topology: event.newDescription.type,
              serverVersion: status.serverVersion
            }
        this.publishStatus(session.status)
      }
      connectedClient.on('topologyDescriptionChanged', onTopologyChanged)
      session.stopMonitoring = () => connectedClient.removeListener('topologyDescriptionChanged', onTopologyChanged)
      this.sessions.set(id, session)
      // TOFU: persist the host key(s) learned on first connect so later connects verify them.
      if (tunnel?.learnedHostKey) {
        connectionStore.recordSshHostKey(id, tunnel.learnedHostKey)
      }
      if (tunnel?.learnedJumpHostKey) {
        connectionStore.recordSshJumpHostKey(id, tunnel.learnedJumpHostKey)
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
        error: err instanceof Error ? err.message : String(err),
        failureKind: classifyConnectionFailure(err)
      }
      return status
    }
  }

  async disconnect(id: string): Promise<void> {
    const pending = this.pending.get(id)
    this.pending.delete(id)
    const s = this.sessions.get(id)
    this.sessions.delete(id)
    s?.stopMonitoring()
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
    try {
      let tunnelPort: number | undefined
      if (dec.config.ssh.enabled) {
        tunnel = new SshTunnel()
        tunnelPort = await tunnel.open(buildTunnelOptions(dec))
      }
      const { uri, options } = buildClientArgs(dec, tunnelPort)
      client = new MongoClient(uri, options)
      await client.connect()
      const info = await this.probe(client)
      return { ok: true, topology: info.topology, serverVersion: info.serverVersion }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        failureKind: classifyConnectionFailure(err)
      }
    } finally {
      await client?.close().catch(() => {})
      tunnel?.close()
    }
  }

  async closeAll(): Promise<void> {
    const ids = new Set([...this.pending.keys(), ...this.sessions.keys()])
    await Promise.all([...ids].map((id) => this.disconnect(id)))
  }
}

export const sessionManager = new SessionManager()
