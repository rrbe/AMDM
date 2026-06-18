import net from 'node:net'
import type { Duplex } from 'node:stream'
import { Client, type ConnectConfig } from 'ssh2'
import type { DiagnoseScope, DiagnoseStage } from '../../shared/types'
import {
  buildTunnelOptions,
  classifyConnError,
  evaluateHostKey,
  planDiagnoseStages,
  type SshHopOptions,
  type TunnelOptions
} from './tunnelCore'
import type { DecryptedConnection } from '../mongo/uri'
import { tcpProbe } from './diagnose'

export type { TunnelOptions }

/**
 * A local TCP forwarder over SSH, optionally through a single jump host.
 *
 * Without a jump: connect to the target, then pipe each inbound local socket
 * through a `forwardOut` channel to MongoDB; the driver connects to the local
 * port as if Mongo were on localhost.
 *
 * With a jump (ProxyJump / the old `ssh -W` ProxyCommand): connect to the
 * bastion, `forwardOut` to the target's SSH port, run a *second* SSH session
 * over that channel to the target, then forward MongoDB from there. Each hop's
 * host key is verified (TOFU) independently.
 *
 * Limitation: a single forwarded node only — SRV/replica-set discovery (which
 * resolves multiple real hostnames) is not supported through the tunnel.
 */
export class SshTunnel {
  private clients: Client[] = []
  private server?: net.Server
  localPort = 0
  /** Target host key learned on first use (TOFU) so the caller can persist it. */
  learnedHostKey?: string
  /** Jump host key learned on first use (TOFU) so the caller can persist it. */
  learnedJumpHostKey?: string

  async open(opts: TunnelOptions): Promise<number> {
    // Network pre-check: fail fast & clearly if the entry hop is unreachable,
    // so a connectivity problem is obvious (vs. an SSH auth / host-key failure).
    const entry = opts.jump ?? opts.target
    await tcpProbe(entry.host, entry.port)

    let transport: Duplex | undefined
    if (opts.jump) {
      const jump = await connectHop(opts.jump, undefined, 'jump host', this.clients)
      this.learnedJumpHostKey = jump.learned
      // Reach the target's SSH port *through* the bastion.
      try {
        transport = await forwardOut(jump.client, opts.target.host, opts.target.port)
      } catch (err) {
        throw new Error(
          `Cannot reach the target ${opts.target.host}:${opts.target.port} through the jump host — ${classifyConnError(err).message}`
        )
      }
    }
    const target = await connectHop(opts.target, transport, 'target', this.clients)
    this.learnedHostKey = target.learned
    this.localPort = await this.listenForward(target.client, opts.destHost, opts.destPort)
    return this.localPort
  }

  /** Stand up the local listener that forwards each accepted socket to MongoDB. */
  private listenForward(client: Client, destHost: string, destPort: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((sock) => {
        client.forwardOut('127.0.0.1', 0, destHost, destPort, (err, stream) => {
          if (err) {
            sock.destroy()
            return
          }
          sock.pipe(stream)
          stream.pipe(sock)
          stream.on('error', () => sock.destroy())
          sock.on('error', () => stream.destroy())
        })
      })
      this.server = server
      server.on('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (addr && typeof addr === 'object') resolve(addr.port)
        else reject(new Error('Failed to bind local tunnel port'))
      })
    })
  }

  close(): void {
    try {
      this.server?.close()
    } catch {
      /* ignore */
    }
    for (const client of this.clients) {
      try {
        client.end()
      } catch {
        /* ignore */
      }
    }
  }
}

/** Promise wrapper around `forwardOut` to reach `host:port` from a connected client. */
function forwardOut(client: Client, host: string, port: number): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    client.forwardOut('127.0.0.1', 0, host, port, (err, stream) => {
      if (err) reject(err)
      else resolve(stream)
    })
  })
}

/**
 * Open one SSH session, optionally tunnelled over an existing transport sock.
 * The created client is pushed to `track` immediately so callers can always
 * tear it down. `role` labels errors so a multi-hop failure points at the hop
 * that broke. Shared by {@link SshTunnel} and {@link diagnoseConnection}.
 */
function connectHop(
  hop: SshHopOptions,
  sock: Duplex | undefined,
  role: string,
  track: Client[]
): Promise<{ client: Client; learned?: string }> {
  const where = `${role} ${hop.host}:${hop.port}`
  return new Promise((resolve, reject) => {
    const client = new Client()
    track.push(client)
    // Capture host-key rejections so we surface a clear message instead of
    // ssh2's generic handshake error (the 'error' event fires right after).
    let hostKeyError: Error | undefined
    let learned: string | undefined

    const cfg: ConnectConfig = {
      host: hop.host,
      port: hop.port,
      username: hop.username,
      password: hop.password,
      privateKey: hop.privateKey,
      passphrase: hop.passphrase,
      sock,
      // hostHash makes ssh2 pass the host key pre-hashed as a hex string.
      hostHash: 'sha256',
      hostVerifier: (fingerprint: string): boolean => {
        const verdict = evaluateHostKey(hop.pinnedHostKey, fingerprint)
        if (verdict.ok) {
          if (verdict.learned) learned = verdict.learned
          return true
        }
        hostKeyError = new Error(
          `Host key verification failed for the ${where} — the SSH server's key changed (possible MITM). ` +
            `Expected SHA256:${hop.pinnedHostKey}, got SHA256:${fingerprint}. ` +
            'If the server was legitimately rebuilt, delete and re-create this connection to trust the new key.'
        )
        return false
      },
      readyTimeout: 20000,
      keepaliveInterval: 15000
    }

    client.on('error', (err) => {
      if (hostKeyError) {
        reject(hostKeyError)
        return
      }
      // Label which hop failed and whether it was network / auth / etc.
      reject(new Error(`SSH ${where} — ${classifyConnError(err).message}`))
    })
    client.on('ready', () => resolve({ client, learned }))
    client.connect(cfg)
  })
}

/**
 * Run a single hop's connectivity check (see {@link planDiagnoseStages} for the
 * `scope` semantics) and report each step's status — so a user sees exactly
 * where it breaks, from the GUI. Stops at the first failure (later steps →
 * 'skip'). Opens no local listener and tears down every SSH client it created.
 */
export async function diagnoseConnection(
  dec: DecryptedConnection,
  scope: DiagnoseScope
): Promise<DiagnoseStage[]> {
  let opts: TunnelOptions
  try {
    opts = buildTunnelOptions(dec)
  } catch (err) {
    return [{ key: 'config', target: '', status: 'fail', detail: (err as Error).message }]
  }

  const clients: Client[] = []
  let jumpClient: Client | undefined

  // Connect the bastion lazily, on the first target step that needs it (the
  // 'ssh' scope reaches the target *through* the jump). Cached so both target
  // steps share one jump connection; a failure here surfaces on that step.
  const ensureJump = async (): Promise<Client> => {
    if (!jumpClient) jumpClient = (await connectHop(opts.jump!, undefined, 'jump host', clients)).client
    return jumpClient
  }

  const runStage = async (key: string): Promise<void> => {
    switch (key) {
      case 'tcp-jump':
        return tcpProbe(opts.jump!.host, opts.jump!.port)
      case 'ssh-jump':
        await connectHop(opts.jump!, undefined, 'jump host', clients)
        return
      case 'tcp-ssh':
        return tcpProbe(opts.target.host, opts.target.port)
      case 'ssh':
        await connectHop(opts.target, undefined, 'target', clients)
        return
      case 'tcp-target': {
        const ch = await forwardOut(await ensureJump(), opts.target.host, opts.target.port)
        ch.destroy()
        return
      }
      case 'ssh-target': {
        const sock = await forwardOut(await ensureJump(), opts.target.host, opts.target.port)
        await connectHop(opts.target, sock, 'target', clients)
        return
      }
    }
  }

  const results: DiagnoseStage[] = []
  let stopped = false
  try {
    for (const { key, target } of planDiagnoseStages(opts, scope)) {
      if (stopped) {
        results.push({ key, target, status: 'skip' })
        continue
      }
      const t0 = Date.now()
      try {
        await runStage(key)
        results.push({ key, target, status: 'ok', ms: Date.now() - t0 })
      } catch (err) {
        results.push({ key, target, status: 'fail', ms: Date.now() - t0, detail: classifyConnError(err).message })
        stopped = true
      }
    }
  } finally {
    for (const c of clients) {
      try {
        c.end()
      } catch {
        /* ignore */
      }
    }
  }
  return results
}
