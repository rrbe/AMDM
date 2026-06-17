/**
 * SSH tunnel option assembly — auth-method decision + agent-socket resolution.
 */
import { describe, it, expect } from 'vitest'
import {
  buildTunnelOptions,
  classifyConnError,
  evaluateHostKey,
  expandHome,
  planDiagnoseStages,
  readPrivateKey,
  resolveSshAgentSock
} from '../../../src/main/ssh/tunnelCore'
import type { DecryptedConnection } from '../../../src/main/mongo/uri'
import type { ConnectionConfig, SshConfig } from '../../../src/shared/types'

const cfg = (ssh: Partial<SshConfig> = {}, over: Partial<ConnectionConfig> = {}): ConnectionConfig => ({
  id: 'c1',
  name: 'conn',
  useSrv: false,
  host: 'db.internal',
  port: 27017,
  auth: { type: 'none' },
  ssh: { enabled: true, host: 'gw.example.com', port: 22, username: 'deploy', ...ssh },
  tls: { enabled: false },
  createdAt: 0,
  updatedAt: 0,
  ...over
})

const dec = (config: ConnectionConfig, secrets: Partial<DecryptedConnection> = {}): DecryptedConnection => ({
  config,
  ...secrets
})

/** Stub reader so the privateKey branch never touches disk. */
const stubKey = (): Buffer => Buffer.from('PRIV')

describe('expandHome', () => {
  it('expands a bare ~ to the home dir', () => {
    expect(expandHome('~', '/home/u')).toBe('/home/u')
  })
  it('expands a leading ~/ to home/...', () => {
    expect(expandHome('~/.ssh/id_ed25519', '/home/u')).toBe('/home/u/.ssh/id_ed25519')
  })
  it('leaves absolute and ~user paths untouched', () => {
    expect(expandHome('/keys/id', '/home/u')).toBe('/keys/id')
    expect(expandHome('~bob/id', '/home/u')).toBe('~bob/id')
  })
})

describe('readPrivateKey', () => {
  it('throws an actionable, path-naming error when the key is unreadable', () => {
    expect(() => readPrivateKey('/no/such/ssh/key/_definitely_missing_')).toThrow(
      /Cannot read SSH private key at ".*_definitely_missing_"/
    )
  })
})

describe('resolveSshAgentSock', () => {
  it('prefers SSH_AUTH_SOCK when set', () => {
    expect(resolveSshAgentSock({ SSH_AUTH_SOCK: '/tmp/agent.sock' }, 'darwin')).toBe('/tmp/agent.sock')
  })
  it('falls back to the Windows OpenSSH named pipe on win32', () => {
    expect(resolveSshAgentSock({}, 'win32')).toBe('\\\\.\\pipe\\openssh-ssh-agent')
  })
  it('returns undefined on posix without SSH_AUTH_SOCK', () => {
    expect(resolveSshAgentSock({}, 'linux')).toBeUndefined()
  })
})

describe('buildTunnelOptions — target auth methods', () => {
  it('password: carries sshPassword, no key/agent', () => {
    const o = buildTunnelOptions(dec(cfg({ authMethod: 'password' }), { sshPassword: 'pw' }), stubKey)
    expect(o.target).toMatchObject({
      host: 'gw.example.com',
      port: 22,
      username: 'deploy',
      password: 'pw'
    })
    expect(o.destHost).toBe('db.internal')
    expect(o.destPort).toBe(27017)
    expect(o.jump).toBeUndefined()
    expect(o.target.privateKey).toBeUndefined()
    expect(o.target.agent).toBeUndefined()
  })

  it('defaults to password when authMethod is unset', () => {
    const o = buildTunnelOptions(dec(cfg({ authMethod: undefined }), { sshPassword: 'pw' }), stubKey)
    expect(o.target.password).toBe('pw')
  })

  it('privateKey: reads the key path and carries the passphrase', () => {
    const o = buildTunnelOptions(
      dec(cfg({ authMethod: 'privateKey', privateKeyPath: '/keys/id_ed25519' }), { sshPassphrase: 'pp' }),
      (p) => {
        expect(p).toBe('/keys/id_ed25519')
        return Buffer.from('PRIV')
      }
    )
    expect(o.target.privateKey?.toString()).toBe('PRIV')
    expect(o.target.passphrase).toBe('pp')
    expect(o.target.password).toBeUndefined()
    expect(o.target.agent).toBeUndefined()
  })

  it('privateKey without a path throws', () => {
    expect(() => buildTunnelOptions(dec(cfg({ authMethod: 'privateKey' })), stubKey)).toThrow(/private key/i)
  })

  it('agent: carries the resolved socket, no key/password', () => {
    const o = buildTunnelOptions(dec(cfg({ authMethod: 'agent' })), stubKey, () => '/tmp/agent.sock')
    expect(o.target.agent).toBe('/tmp/agent.sock')
    expect(o.target.privateKey).toBeUndefined()
    expect(o.target.password).toBeUndefined()
  })

  it('agent without a resolvable socket throws', () => {
    expect(() => buildTunnelOptions(dec(cfg({ authMethod: 'agent' })), stubKey, () => undefined)).toThrow(
      /agent/i
    )
  })

  it('threads the pinned host key through', () => {
    const o = buildTunnelOptions(dec(cfg({ authMethod: 'agent', pinnedHostKey: 'abc123' })), stubKey, () => '/s')
    expect(o.target.pinnedHostKey).toBe('abc123')
  })
})

describe('buildTunnelOptions — jump host (ProxyJump)', () => {
  it('builds a jump hop alongside the target, with its own auth + pin', () => {
    const o = buildTunnelOptions(
      dec(
        cfg({
          authMethod: 'agent',
          pinnedHostKey: 'target-fp',
          jump: {
            host: 'bastion.example.com',
            port: 3522,
            username: 'shawn',
            authMethod: 'agent',
            pinnedHostKey: 'jump-fp'
          }
        }),
        {}
      ),
      stubKey,
      () => '/tmp/agent.sock'
    )
    expect(o.target).toMatchObject({ host: 'gw.example.com', agent: '/tmp/agent.sock', pinnedHostKey: 'target-fp' })
    expect(o.jump).toMatchObject({
      host: 'bastion.example.com',
      port: 3522,
      username: 'shawn',
      agent: '/tmp/agent.sock',
      pinnedHostKey: 'jump-fp'
    })
  })

  it('a jump hop carries its own passphrase but never a password', () => {
    const o = buildTunnelOptions(
      dec(
        cfg({
          authMethod: 'agent',
          jump: { host: 'b', username: 'u', authMethod: 'privateKey', privateKeyPath: '/k/jump' }
        }),
        { sshPassword: 'pw', sshPassphrase: 'pp', jumpSshPassphrase: 'jpp' }
      ),
      () => Buffer.from('JUMPKEY'),
      () => '/tmp/agent.sock'
    )
    expect(o.jump?.privateKey?.toString()).toBe('JUMPKEY')
    expect(o.jump?.passphrase).toBe('jpp') // its own jump passphrase, not the target's
    expect(o.jump?.password).toBeUndefined() // jump never uses a stored password
  })
})

describe('classifyConnError', () => {
  it('maps socket codes to a network kind', () => {
    expect(classifyConnError({ code: 'ECONNREFUSED' }).kind).toBe('network')
    expect(classifyConnError({ code: 'EHOSTUNREACH' }).kind).toBe('network')
    expect(classifyConnError({ code: 'ENETUNREACH' }).kind).toBe('network')
  })
  it('maps timeouts and DNS failures', () => {
    expect(classifyConnError({ code: 'ETIMEDOUT' }).kind).toBe('timeout')
    expect(classifyConnError({ level: 'client-timeout' }).kind).toBe('timeout')
    expect(classifyConnError({ code: 'ENOTFOUND' }).kind).toBe('dns')
  })
  it('classifies ssh2 auth failures by level or message', () => {
    expect(classifyConnError({ level: 'client-authentication' }).kind).toBe('auth')
    expect(classifyConnError(new Error('All configured authentication methods failed')).kind).toBe('auth')
  })
  it('recognizes host-key errors and falls back to other', () => {
    expect(classifyConnError(new Error('Host key verification failed for x')).kind).toBe('hostkey')
    expect(classifyConnError(new Error('something odd')).kind).toBe('other')
  })
})

describe('planDiagnoseStages', () => {
  const opts = (jump?: object) => ({
    target: { host: 'cai', port: 22, username: 'root' },
    jump: jump as never,
    destHost: '127.0.0.1',
    destPort: 27017
  })
  it('plans tcp→ssh→mongo without a jump', () => {
    const keys = planDiagnoseStages(opts()).map((s) => s.key)
    expect(keys).toEqual(['tcp-ssh', 'ssh', 'tcp-mongo'])
  })
  it('plans both hops when a jump is present, with correct targets', () => {
    const stages = planDiagnoseStages(opts({ host: 'cao', port: 3522, username: 'shawn' }))
    expect(stages.map((s) => s.key)).toEqual([
      'tcp-jump',
      'ssh-jump',
      'tcp-target',
      'ssh-target',
      'tcp-mongo'
    ])
    expect(stages.find((s) => s.key === 'tcp-jump')?.target).toBe('cao:3522')
    expect(stages.find((s) => s.key === 'tcp-target')?.target).toBe('cai:22')
    expect(stages.find((s) => s.key === 'tcp-mongo')?.target).toBe('127.0.0.1:27017')
  })
})

describe('evaluateHostKey (TOFU)', () => {
  it('first use (no pin) accepts and learns the fingerprint', () => {
    expect(evaluateHostKey(undefined, 'fp1')).toEqual({ ok: true, learned: 'fp1' })
  })
  it('a matching pin accepts without re-learning', () => {
    expect(evaluateHostKey('fp1', 'fp1')).toEqual({ ok: true })
  })
  it('a changed key is rejected', () => {
    expect(evaluateHostKey('fp1', 'fp2')).toEqual({ ok: false })
  })
})

describe('buildTunnelOptions — guards & defaults', () => {
  it('throws for SRV/Atlas (single forwarded socket only)', () => {
    expect(() =>
      buildTunnelOptions(dec(cfg({ authMethod: 'password' }, { useSrv: true })), stubKey)
    ).toThrow(/SRV/i)
  })

  it('defaults ssh port to 22 and dest port to 27017', () => {
    const o = buildTunnelOptions(
      dec(cfg({ authMethod: 'agent', port: undefined }, { port: undefined })),
      stubKey,
      () => '/s'
    )
    expect(o.target.port).toBe(22)
    expect(o.destPort).toBe(27017)
  })
})
