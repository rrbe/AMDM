import net from 'node:net'
import { Client, type ConnectConfig } from 'ssh2'
import { evaluateHostKey, type TunnelOptions } from './tunnelCore'

export type { TunnelOptions }

/**
 * A local TCP forwarder over SSH. We open an SSH connection, stand up a local
 * server on 127.0.0.1:<ephemeral>, and pipe each incoming socket through an
 * `forwardOut` channel to the real MongoDB host. The driver then connects to
 * the local port as if Mongo were on localhost.
 *
 * Limitation: a single forwarded node only — SRV/replica-set discovery (which
 * resolves multiple real hostnames) is not supported through the tunnel; use a
 * direct single-host connection with SSH.
 */
export class SshTunnel {
  private client = new Client()
  private server?: net.Server
  localPort = 0
  /** Set after a first-use connection (no prior pin) so the caller can persist it. */
  learnedHostKey?: string

  open(opts: TunnelOptions): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      // Capture host-key rejections so we can surface a clear message instead of
      // ssh2's generic handshake error (the 'error' event fires right after).
      let hostKeyError: Error | undefined

      const connectConfig: ConnectConfig = {
        host: opts.sshHost,
        port: opts.sshPort,
        username: opts.username,
        password: opts.password,
        privateKey: opts.privateKey,
        passphrase: opts.passphrase,
        agent: opts.agent,
        // hostHash makes ssh2 pass the host key pre-hashed as a hex string.
        hostHash: 'sha256',
        hostVerifier: (fingerprint: string): boolean => {
          const verdict = evaluateHostKey(opts.pinnedHostKey, fingerprint)
          if (verdict.ok) {
            if (verdict.learned) this.learnedHostKey = verdict.learned
            return true
          }
          hostKeyError = new Error(
            "Host key verification failed — the SSH server's key changed (possible MITM). " +
              `Expected SHA256:${opts.pinnedHostKey}, got SHA256:${fingerprint}. ` +
              'If the server was legitimately rebuilt, reset the trusted host key in the connection’s SSH settings.'
          )
          return false
        },
        readyTimeout: 20000,
        keepaliveInterval: 15000
      }

      this.client.on('error', (err) => reject(hostKeyError ?? err))

      this.client.on('ready', () => {
        this.server = net.createServer((sock) => {
          this.client.forwardOut(
            '127.0.0.1',
            0,
            opts.destHost,
            opts.destPort,
            (err, stream) => {
              if (err) {
                sock.destroy()
                return
              }
              sock.pipe(stream)
              stream.pipe(sock)
              stream.on('error', () => sock.destroy())
              sock.on('error', () => stream.destroy())
            }
          )
        })

        this.server.on('error', (err) => reject(err))
        this.server.listen(0, '127.0.0.1', () => {
          const addr = this.server!.address()
          if (addr && typeof addr === 'object') {
            this.localPort = addr.port
            resolve(this.localPort)
          } else {
            reject(new Error('Failed to bind local tunnel port'))
          }
        })
      })

      this.client.connect(connectConfig)
    })
  }

  close(): void {
    try {
      this.server?.close()
    } catch {
      /* ignore */
    }
    try {
      this.client.end()
    } catch {
      /* ignore */
    }
  }
}
