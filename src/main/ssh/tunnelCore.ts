/**
 * Pure core for SSH tunnel option assembly (no ssh2 / electron deps), so the
 * auth-method decision is unit-testable. The effectful wrapper ({@link SshTunnel}
 * in `tunnel.ts`) only does the ssh2 Client + net.Server side effects.
 *
 * File reads (private key) are injected so the decision logic stays pure; the
 * default reader does real disk IO at connect time.
 */
import { readFileSync } from 'node:fs'
import type { DecryptedConnection } from '../mongo/uri'

export interface TunnelOptions {
  sshHost: string
  sshPort: number
  username: string
  password?: string
  privateKey?: Buffer
  passphrase?: string
  /** ssh-agent socket (SSH_AUTH_SOCK) or Windows OpenSSH pipe — for agent auth. */
  agent?: string
  /** Final MongoDB host/port to forward to (as seen from the SSH server). */
  destHost: string
  destPort: number
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

/**
 * Build {@link TunnelOptions} from a decrypted connection. Throws (rather than
 * silently misconfiguring) when the chosen auth method lacks what it needs.
 */
export function buildTunnelOptions(
  dec: DecryptedConnection,
  readKey: (path: string) => Buffer = (p) => readFileSync(p),
  resolveAgent: () => string | undefined = resolveSshAgentSock
): TunnelOptions {
  const { config } = dec
  if (config.useSrv) {
    throw new Error('SSH tunnel with SRV/Atlas is not supported — use a direct host:port.')
  }

  const base: TunnelOptions = {
    sshHost: config.ssh.host || '',
    sshPort: config.ssh.port || 22,
    username: config.ssh.username || '',
    destHost: config.host,
    destPort: config.port ?? 27017
  }

  switch (config.ssh.authMethod ?? 'password') {
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
      if (!config.ssh.privateKeyPath) {
        throw new Error('SSH private-key auth requires a private key path.')
      }
      return { ...base, privateKey: readKey(config.ssh.privateKeyPath), passphrase: dec.sshPassphrase }
    default: // 'password'
      return { ...base, password: dec.sshPassword }
  }
}
