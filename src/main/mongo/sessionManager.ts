import { readFileSync } from 'node:fs'
import { MongoClient } from 'mongodb'
import type { ConnectionStatus, TestResult } from '../../shared/types'
import { connectionStore } from '../store/connectionStore'
import { SshTunnel } from '../ssh/tunnel'
import { buildClientArgs, type DecryptedConnection } from './uri'

interface Session {
  client: MongoClient
  tunnel?: SshTunnel
  status: ConnectionStatus
}

/** Owns all live MongoClient connections and their SSH tunnels. */
class SessionManager {
  private sessions = new Map<string, Session>()

  getStatus(id: string): ConnectionStatus {
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

  private async openTunnel(dec: DecryptedConnection): Promise<number> {
    const { config } = dec
    if (config.useSrv) {
      throw new Error('SSH tunnel with SRV/Atlas is not supported — use a direct host:port.')
    }
    const tunnel = new SshTunnel()
    const port = await tunnel.open({
      sshHost: config.ssh.host || '',
      sshPort: config.ssh.port || 22,
      username: config.ssh.username || '',
      password: config.ssh.authMethod === 'password' ? dec.sshPassword : undefined,
      privateKey:
        config.ssh.authMethod === 'privateKey' && config.ssh.privateKeyPath
          ? readFileSync(config.ssh.privateKeyPath)
          : undefined,
      passphrase: dec.sshPassphrase,
      destHost: config.host,
      destPort: config.port ?? 27017
    })
    // stash tunnel so we can close it on disconnect
    this.pendingTunnel = tunnel
    return port
  }

  private pendingTunnel?: SshTunnel

  private async probe(client: MongoClient): Promise<{ topology?: string; serverVersion?: string }> {
    try {
      const admin = client.db('admin')
      const hello = (await admin.command({ hello: 1 })) as Record<string, unknown>
      const build = (await admin.command({ buildInfo: 1 })) as Record<string, unknown>
      const topology = hello.setName
        ? 'ReplicaSet'
        : hello.msg === 'isdbgrid'
          ? 'Sharded'
          : 'Single'
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
      const status: ConnectionStatus = { id, state: 'error', error: 'Connection not found' }
      return status
    }

    try {
      this.pendingTunnel = undefined
      let tunnelPort: number | undefined
      if (dec.config.ssh.enabled) {
        tunnelPort = await this.openTunnel(dec)
      }

      const { uri, options } = buildClientArgs(dec, tunnelPort)
      const client = new MongoClient(uri, options)
      await client.connect()
      const info = await this.probe(client)

      const status: ConnectionStatus = {
        id,
        state: 'connected',
        topology: info.topology,
        serverVersion: info.serverVersion
      }
      this.sessions.set(id, { client, tunnel: this.pendingTunnel, status })
      this.pendingTunnel = undefined
      return status
    } catch (err) {
      this.pendingTunnel?.close()
      this.pendingTunnel = undefined
      const status: ConnectionStatus = {
        id,
        state: 'error',
        error: err instanceof Error ? err.message : String(err)
      }
      return status
    }
  }

  async disconnect(id: string): Promise<void> {
    const s = this.sessions.get(id)
    if (!s) return
    this.sessions.delete(id)
    try {
      await s.client.close()
    } catch {
      /* ignore */
    }
    s.tunnel?.close()
  }

  async test(dec: DecryptedConnection): Promise<TestResult> {
    let tunnel: SshTunnel | undefined
    let client: MongoClient | undefined
    try {
      let tunnelPort: number | undefined
      if (dec.config.ssh.enabled) {
        if (dec.config.useSrv) throw new Error('SSH tunnel with SRV/Atlas is not supported.')
        tunnel = new SshTunnel()
        tunnelPort = await tunnel.open({
          sshHost: dec.config.ssh.host || '',
          sshPort: dec.config.ssh.port || 22,
          username: dec.config.ssh.username || '',
          password: dec.config.ssh.authMethod === 'password' ? dec.sshPassword : undefined,
          privateKey:
            dec.config.ssh.authMethod === 'privateKey' && dec.config.ssh.privateKeyPath
              ? readFileSync(dec.config.ssh.privateKeyPath)
              : undefined,
          passphrase: dec.sshPassphrase,
          destHost: dec.config.host,
          destPort: dec.config.port ?? 27017
        })
      }
      const { uri, options } = buildClientArgs(dec, tunnelPort)
      client = new MongoClient(uri, options)
      await client.connect()
      const info = await this.probe(client)
      return { ok: true, topology: info.topology, serverVersion: info.serverVersion }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      await client?.close().catch(() => {})
      tunnel?.close()
    }
  }

  async closeAll(): Promise<void> {
    const ids = [...this.sessions.keys()]
    await Promise.all(ids.map((id) => this.disconnect(id)))
  }
}

export const sessionManager = new SessionManager()
