/**
 * SSH tunnel option assembly — auth-method decision + agent-socket resolution.
 */
import { describe, it, expect } from 'vitest'
import {
  buildTunnelOptions,
  evaluateHostKey,
  expandHome,
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

describe('buildTunnelOptions — auth methods', () => {
  it('password: carries sshPassword, no key/agent', () => {
    const o = buildTunnelOptions(dec(cfg({ authMethod: 'password' }), { sshPassword: 'pw' }), stubKey)
    expect(o).toMatchObject({
      sshHost: 'gw.example.com',
      sshPort: 22,
      username: 'deploy',
      destHost: 'db.internal',
      destPort: 27017,
      password: 'pw'
    })
    expect(o.privateKey).toBeUndefined()
    expect(o.agent).toBeUndefined()
  })

  it('defaults to password when authMethod is unset', () => {
    const o = buildTunnelOptions(dec(cfg({ authMethod: undefined }), { sshPassword: 'pw' }), stubKey)
    expect(o.password).toBe('pw')
  })

  it('privateKey: reads the key path and carries the passphrase', () => {
    const o = buildTunnelOptions(
      dec(cfg({ authMethod: 'privateKey', privateKeyPath: '/keys/id_ed25519' }), { sshPassphrase: 'pp' }),
      (p) => {
        expect(p).toBe('/keys/id_ed25519')
        return Buffer.from('PRIV')
      }
    )
    expect(o.privateKey?.toString()).toBe('PRIV')
    expect(o.passphrase).toBe('pp')
    expect(o.password).toBeUndefined()
    expect(o.agent).toBeUndefined()
  })

  it('privateKey without a path throws', () => {
    expect(() => buildTunnelOptions(dec(cfg({ authMethod: 'privateKey' })), stubKey)).toThrow(/private key/i)
  })

  it('agent: carries the resolved socket, no key/password', () => {
    const o = buildTunnelOptions(dec(cfg({ authMethod: 'agent' })), stubKey, () => '/tmp/agent.sock')
    expect(o.agent).toBe('/tmp/agent.sock')
    expect(o.privateKey).toBeUndefined()
    expect(o.password).toBeUndefined()
  })

  it('agent without a resolvable socket throws', () => {
    expect(() => buildTunnelOptions(dec(cfg({ authMethod: 'agent' })), stubKey, () => undefined)).toThrow(
      /agent/i
    )
  })

  it('threads the pinned host key through', () => {
    const o = buildTunnelOptions(dec(cfg({ authMethod: 'agent', pinnedHostKey: 'abc123' })), stubKey, () => '/s')
    expect(o.pinnedHostKey).toBe('abc123')
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
    expect(o.sshPort).toBe(22)
    expect(o.destPort).toBe(27017)
  })
})
