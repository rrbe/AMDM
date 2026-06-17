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
  /** ssh-agent socket (SSH_AUTH_SOCK) or Windows OpenSSH pipe — for agent auth. */
  agent?: string
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

/** Windows 10/11 built-in OpenSSH agent named pipe (ssh2 accepts it as `agent`). */
const WIN_OPENSSH_AGENT_PIPE = '\\\\.\\pipe\\openssh-ssh-agent'

/**
 * Locate the local ssh-agent endpoint. Prefers `SSH_AUTH_SOCK` (set on
 * macOS/Linux and by most Windows agents that bother); falls back to the
 * Windows OpenSSH named pipe. Returns undefined when no agent can be located.
 */
export function resolveSshAgentSock(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string | undefined {
  if (env.SSH_AUTH_SOCK) return env.SSH_AUTH_SOCK
  if (platform === 'win32') return WIN_OPENSSH_AGENT_PIPE
  return undefined
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
  readKey: (path: string) => Buffer,
  resolveAgent: () => string | undefined
): SshHopOptions {
  const base: SshHopOptions = {
    host: hop.host || '',
    port: hop.port || 22,
    username: hop.username || '',
    pinnedHostKey: hop.pinnedHostKey
  }
  switch (hop.authMethod ?? 'password') {
    case 'agent': {
      const agentSock = resolveAgent()
      if (!agentSock) {
        throw new Error(
          'SSH agent is unavailable: no SSH_AUTH_SOCK found. Start your ssh-agent and `ssh-add` your key, or use a private key file.'
        )
      }
      return { ...base, agent: agentSock }
    }
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
 * jump hop authenticates via agent or a key file only — no stored secrets.
 */
export function buildTunnelOptions(
  dec: DecryptedConnection,
  readKey: (path: string) => Buffer = readPrivateKey,
  resolveAgent: () => string | undefined = resolveSshAgentSock
): TunnelOptions {
  const { config } = dec
  if (config.useSrv) {
    throw new Error('SSH tunnel with SRV/Atlas is not supported — use a direct host:port.')
  }

  const target = buildHop(
    config.ssh,
    { password: dec.sshPassword, passphrase: dec.sshPassphrase },
    readKey,
    resolveAgent
  )
  const jump = config.ssh.jump ? buildHop(config.ssh.jump, {}, readKey, resolveAgent) : undefined

  return { target, jump, destHost: config.host, destPort: config.port ?? 27017 }
}
