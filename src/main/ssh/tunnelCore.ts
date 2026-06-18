/**
 * Pure core for SSH tunnel option assembly (no ssh2 / electron deps), so the
 * auth-method decision is unit-testable. The effectful wrapper ({@link SshTunnel}
 * in `tunnel.ts`) only does the ssh2 Client + net.Server side effects.
 *
 * File reads (private key) are injected so the decision logic stays pure; the
 * default reader does real disk IO at connect time.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SshAuthMethod } from '../../shared/types'
import type { DecryptedConnection } from '../mongo/uri'

/** Auth + identity for a single SSH hop (a bastion or the terminal host). */
export interface SshHopOptions {
  host: string
  port: number
  username: string
  password?: string
  privateKey?: Buffer
  passphrase?: string
  /** Previously-pinned SHA256 host-key fingerprint (TOFU); undefined on first use. */
  pinnedHostKey?: string
}

export interface TunnelOptions {
  /** Terminal SSH host — the machine MongoDB runs on. */
  target: SshHopOptions
  /** Optional single bastion in front of the target (ProxyJump / `ssh -W`). */
  jump?: SshHopOptions
  /** Final MongoDB host/port to forward to (as seen from the target host). */
  destHost: string
  destPort: number
}

export interface HostKeyVerdict {
  /** Whether to proceed with the connection. */
  ok: boolean
  /** Set only on first use (no prior pin): the fingerprint the caller should persist. */
  learned?: string
}

/**
 * Trust-on-first-use host-key check. With no prior pin we accept and report the
 * fingerprint to learn; with a pin we accept only an exact match and otherwise
 * reject (a changed key means the server was rebuilt — or a MITM).
 */
export function evaluateHostKey(pinned: string | undefined, presented: string): HostKeyVerdict {
  if (!pinned) return { ok: true, learned: presented }
  if (pinned === presented) return { ok: true }
  return { ok: false }
}

export type ConnErrorKind = 'network' | 'timeout' | 'dns' | 'auth' | 'hostkey' | 'other'

/**
 * Classify a connection/SSH error so a network problem is distinguishable from
 * an auth or host-key problem. Pure: maps Node socket `code`s and ssh2
 * `level`/message shapes to a kind + a short actionable message.
 */
export function classifyConnError(err: unknown): { kind: ConnErrorKind; message: string } {
  const e = (err ?? {}) as { code?: string; level?: string; message?: string }
  const code = e.code
  const msg = e.message ?? String(err)
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return { kind: 'dns', message: 'host name could not be resolved (DNS)' }
  }
  if (code === 'ECONNREFUSED') {
    return {
      kind: 'network',
      message: 'connection refused — nothing is listening on that port, or a firewall rejected it'
    }
  }
  if (code === 'ETIMEDOUT' || code === 'ETIME' || e.level === 'client-timeout') {
    return { kind: 'timeout', message: 'connection timed out — the host is unreachable or the port is filtered' }
  }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'EHOSTDOWN') {
    return { kind: 'network', message: 'host or network is unreachable' }
  }
  if (e.level === 'client-authentication' || /authentication methods failed/i.test(msg)) {
    return {
      kind: 'auth',
      message:
        'SSH authentication was rejected — check the username, or switch the auth method to “Private Key” and pick your key file (with its passphrase) in the connection settings'
    }
  }
  if (/host key/i.test(msg)) return { kind: 'hostkey', message: msg }
  return { kind: 'other', message: msg }
}

/**
 * Expand a leading `~` / `~/` to the user's home directory. Node's `fs` does
 * NOT do this, so a privateKeyPath like `~/.ssh/id_ed25519` (which the form
 * advertises) would otherwise ENOENT. Only the leading `~` is handled; `~user`
 * is left untouched.
 */
export function expandHome(p: string, home: string = homedir()): string {
  if (p === '~') return home
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(home, p.slice(2))
  return p
}

/**
 * Read a private key file (expanding a leading `~`), turning the raw Node fs
 * error into an actionable message that names the resolved path.
 */
export function readPrivateKey(path: string): Buffer {
  const full = expandHome(path)
  try {
    return readFileSync(full)
  } catch {
    throw new Error(`Cannot read SSH private key at "${full}" — check the path and file permissions.`)
  }
}

/** The hop-config fields shared by the target `SshConfig` and a jump hop. */
interface HopConfigLike {
  host?: string
  port?: number
  username?: string
  authMethod?: SshAuthMethod
  privateKeyPath?: string
  pinnedHostKey?: string
}

/** Resolve one hop's auth into {@link SshHopOptions}, throwing on missing inputs. */
function buildHop(
  hop: HopConfigLike,
  secrets: { password?: string; passphrase?: string },
  readKey: (path: string) => Buffer
): SshHopOptions {
  const base: SshHopOptions = {
    host: hop.host || '',
    port: hop.port || 22,
    username: hop.username || '',
    pinnedHostKey: hop.pinnedHostKey
  }
  switch (hop.authMethod ?? 'password') {
    case 'privateKey':
      if (!hop.privateKeyPath) {
        throw new Error('SSH private-key auth requires a private key path.')
      }
      return { ...base, privateKey: readKey(hop.privateKeyPath), passphrase: secrets.passphrase }
    default: // 'password'
      return { ...base, password: secrets.password }
  }
}

/**
 * Build {@link TunnelOptions} from a decrypted connection. Throws (rather than
 * silently misconfiguring) when an auth method lacks what it needs. An optional
 * jump hop authenticates via a private key file only — no stored password.
 */
export function buildTunnelOptions(
  dec: DecryptedConnection,
  readKey: (path: string) => Buffer = readPrivateKey
): TunnelOptions {
  const { config } = dec
  if (config.useSrv) {
    throw new Error('SSH tunnel with SRV/Atlas is not supported — use a direct host:port.')
  }

  const target = buildHop(config.ssh, { password: dec.sshPassword, passphrase: dec.sshPassphrase }, readKey)
  const jump = config.ssh.jump
    ? buildHop(config.ssh.jump, { passphrase: dec.jumpSshPassphrase }, readKey)
    : undefined

  return { target, jump, destHost: config.host, destPort: config.port ?? 27017 }
}

/**
 * The ordered connectivity-check steps for a tunnel — pure, so the stage list is
 * unit-testable. `key` maps to a localized label in the renderer; `target` is the
 * host:port that step checks. The effectful runner (diagnoseConnection) executes
 * each in turn, stopping at the first failure.
 */
export function planDiagnoseStages(opts: TunnelOptions): { key: string; target: string }[] {
  const t = opts.target
  const stages: { key: string; target: string }[] = []
  if (opts.jump) {
    const j = opts.jump
    stages.push({ key: 'tcp-jump', target: `${j.host}:${j.port}` })
    stages.push({ key: 'ssh-jump', target: `${j.host}:${j.port}` })
    stages.push({ key: 'tcp-target', target: `${t.host}:${t.port}` })
    stages.push({ key: 'ssh-target', target: `${t.host}:${t.port}` })
  } else {
    stages.push({ key: 'tcp-ssh', target: `${t.host}:${t.port}` })
    stages.push({ key: 'ssh', target: `${t.host}:${t.port}` })
  }
  stages.push({ key: 'tcp-mongo', target: `${opts.destHost}:${opts.destPort}` })
  return stages
}
