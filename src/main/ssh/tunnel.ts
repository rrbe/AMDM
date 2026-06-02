import net from 'node:net'
import { Client, type ConnectConfig } from 'ssh2'

export interface TunnelOptions {
  sshHost: string
  sshPort: number
  username: string
  password?: string
  privateKey?: Buffer
  passphrase?: string
  /** Final MongoDB host/port to forward to (as seen from the SSH server). */
  destHost: string
  destPort: number
}

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

  open(opts: TunnelOptions): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const connectConfig: ConnectConfig = {
        host: opts.sshHost,
        port: opts.sshPort,
        username: opts.username,
        password: opts.password,
        privateKey: opts.privateKey,
        passphrase: opts.passphrase,
        readyTimeout: 20000,
        keepaliveInterval: 15000
      }

      this.client.on('error', (err) => reject(err))

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
