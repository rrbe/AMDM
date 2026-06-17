import net from 'node:net'
import type { Duplex } from 'node:stream'
import { Client, type ConnectConfig } from 'ssh2'
import { classifyConnError, evaluateHostKey, type SshHopOptions, type TunnelOptions } from './tunnelCore'
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
      const jump = await this.connectHop(opts.jump, undefined, 'jump host')
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
    const target = await this.connectHop(opts.target, transport, 'target')
    this.learnedHostKey = target.learned
    this.localPort = await this.listenForward(target.client, opts.destHost, opts.destPort)
    return this.localPort
  }

  /**
   * Open one SSH session, optionally tunnelled over an existing transport sock.
   * `role` ("jump host" / "target") labels errors so a multi-hop failure points
   * at the hop that broke.
   */
  private connectHop(
    hop: SshHopOptions,
    sock: Duplex | undefined,
    role: string
  ): Promise<{ client: Client; learned?: string }> {
    const where = `${role} ${hop.host}:${hop.port}`
    return new Promise((resolve, reject) => {
      const client = new Client()
      this.clients.push(client)
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
        agent: hop.agent,
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
              'If the server was legitimately rebuilt, reset the trusted host key in the connection’s SSH settings.'
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
