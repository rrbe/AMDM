import { createCipheriv, createDecipheriv, pbkdf2Sync, scryptSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { EJSON } from 'bson'
import type { ConnectionInput } from '../../../src/shared/types'
import {
  CONNECTION_TRANSFER_ERROR_CODES,
  CONNECTION_TRANSFER_WARNING_CODES,
  connectionTransferWarnings,
  decodeConnections,
  encodeConnections,
  mongoUriForTransfer
} from '../../../src/main/io/connectionTransferCore'

const password = 'p@ss:%汉\nword'
const passphrase = 'transfer 🔐 phrase'
function input(overrides: Partial<ConnectionInput> = {}): ConnectionInput {
  return {
    id: 'existing-id',
    name: 'Production',
    color: '#3b82f6',
    host: 'db1:27017,db2:27018',
    useSrv: false,
    replicaSet: 'rs0',
    defaultDatabase: 'app',
    auth: { type: 'scram', username: 'u@ser', authSource: 'admin', mechanism: 'SCRAM-SHA-256' },
    ssh: { enabled: false },
    tls: { enabled: false },
    password,
    ...overrides
  }
}
function amdm(connections: unknown[], rest: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: 'AMDM Connections', version: 1, connections, ...rest })
}
function compass(connections: unknown[]): string {
  return EJSON.stringify(
    { type: 'Compass Connections', version: 1, connections },
    { relaxed: false }
  )
}
function robo(connections: unknown[]): string {
  return JSON.stringify({ connections })
}
function compassRow(connectionString = 'mongodb://user@db/app?authSource=admin', rest = {}) {
  return {
    id: 'external',
    favorite: { name: 'Compass', color: '#3b82f6' },
    connectionOptions: { connectionString },
    ...rest
  }
}

// Independent Node implementation of the published Compass source, not the
// codec under test. Pinned upstream implementation:
// https://github.com/mongodb-js/compass/blob/0bcef5ae094a4e866695de71139cc84494f5807d/packages/connection-storage/src/encrypt.ts
// https://github.com/mongodb-js/compass/blob/0bcef5ae094a4e866695de71139cc84494f5807d/packages/connection-info/src/connection-secrets.ts
function upstreamEncrypt(
  secrets: Record<string, unknown>,
  phrase = passphrase,
  saltByte = 3
): string {
  const salt = Buffer.alloc(16, saltByte),
    iv = Buffer.alloc(16, 7)
  const key = pbkdf2Sync(Buffer.from(phrase), salt, 100_000, 32, 'sha512')
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([
    cipher.update(EJSON.stringify({ secrets }, { relaxed: false }), 'utf8'),
    cipher.final()
  ])
  return Buffer.concat([Buffer.from([0, 1]), salt, iv, cipher.getAuthTag(), encrypted]).toString(
    'base64'
  )
}
function upstreamDecrypt(encrypted: string): Record<string, string> {
  const bytes = Buffer.from(encrypted, 'base64')
  expect(bytes.readUInt16BE(0)).toBe(1)
  const key = pbkdf2Sync(passphrase, bytes.subarray(2, 18), 100_000, 32, 'sha512')
  const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(18, 34))
  cipher.setAuthTag(bytes.subarray(34, 50))
  return EJSON.parse(Buffer.concat([cipher.update(bytes.subarray(50)), cipher.final()]).toString())
    .secrets
}

function expectSafeRows(rows: Awaited<ReturnType<typeof decodeConnections>>): void {
  for (const row of rows) {
    for (const code of row.warnings) expect(CONNECTION_TRANSFER_WARNING_CODES).toContain(code.split(':')[0])
    if (row.error) {
      expect(CONNECTION_TRANSFER_ERROR_CODES).toContain(row.error)
      expect(row.input).toEqual({
        id: '',
        name: '',
        host: '',
        useSrv: false,
        auth: { type: 'none' },
        ssh: { enabled: false },
        tls: { enabled: false }
      })
      expect(JSON.stringify(row)).not.toContain('dont-leak-me')
    }
  }
}

describe('AMDM connection backup', () => {
  it('round-trips complete settings and strips identity and store metadata', async () => {
    const original = input({
      ssh: {
        enabled: true,
        host: 'ssh',
        port: 2222,
        username: 'me',
        authMethod: 'privateKey',
        privateKeyPath: '/key',
        pinnedHostKey: 'pin',
        jump: {
          host: 'jump',
          username: 'j',
          port: 22,
          authMethod: 'privateKey',
          privateKeyPath: '/jump',
          pinnedHostKey: 'jpin'
        }
      },
      tls: {
        enabled: true,
        caFile: '/ca.pem',
        certificateKeyFile: '/client.pem',
        allowInvalidCertificates: true
      },
      sshPassword: 'ssh\npassword',
      sshPassphrase: 'key\nphrase',
      jumpSshPassphrase: 'jump\nphrase',
      options: {
        retryWrites: 'false',
        unusualFutureOption: 'a,b:1',
        MiXeDCasing: 'preserve exactly',
        'vendor.option_name': 'opaque\nvalue'
      },
      copyFromId: 'never-copy'
    })
    Object.assign(original, { createdAt: 123, updatedAt: 456, hasPassword: true })
    const text = await encodeConnections([original], 'amdm', true, passphrase)
    for (const value of [
      'Production',
      'db1',
      password,
      'never-copy',
      'existing-id',
      'privateKeyPath'
    ])
      expect(text).not.toContain(value)
    const [row] = await decodeConnections(text, passphrase)
    expect(row.error).toBeUndefined()
    const { id: _, copyFromId: __, ...expected } = input(original)
    delete (expected as Record<string, unknown>).createdAt
    delete (expected as Record<string, unknown>).updatedAt
    delete (expected as Record<string, unknown>).hasPassword
    expect(row.input).toMatchObject({ ...expected, id: '' })
    expect(row.input).not.toHaveProperty('copyFromId')
    expect(row.input).not.toHaveProperty('createdAt')
    expect(row.warnings).toEqual(['externalFiles'])
    expect(JSON.parse(text).encryption).toMatchObject({
      cipher: 'aes-256-gcm',
      kdf: 'scrypt',
      N: 32768,
      r: 8,
      p: 1
    })
  })

  it('decrypts whole payload with an independent scrypt/GCM implementation', async () => {
    const e = JSON.parse(await encodeConnections([input()], 'amdm', true, passphrase))
    const key = scryptSync(passphrase, Buffer.from(e.encryption.salt, 'base64'), 32, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024
    })
    const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(e.encryption.iv, 'base64'))
    cipher.setAAD(Buffer.from('AMDM Connections:1'))
    cipher.setAuthTag(Buffer.from(e.encryption.tag, 'base64'))
    const payload = JSON.parse(
      Buffer.concat([cipher.update(Buffer.from(e.ciphertext, 'base64')), cipher.final()]).toString()
    )
    expect(payload).toMatchObject({
      type: 'AMDM Connections',
      version: 1,
      connections: [{ password, name: 'Production' }]
    })
  })

  it('requires a passphrase whenever secrets are requested', async () => {
    await expect(encodeConnections([input()], 'amdm', true)).rejects.toThrow('passwordRequired')
    await expect(encodeConnections([], 'amdm', true, '')).rejects.toThrow('passwordRequired')
  })

  it('removes every secret when exporting clear text and leaves the caller unchanged', async () => {
    const original = input({ sshPassword: 'ssh', sshPassphrase: 'key', jumpSshPassphrase: 'jump' })
    const snapshot = structuredClone(original)
    const text = await encodeConnections([original], 'amdm', false)
    const [row] = await decodeConnections(text)
    for (const key of [
      'password',
      'sshPassword',
      'sshPassphrase',
      'jumpSshPassphrase',
      'id',
      'copyFromId',
      'createdAt',
      'updatedAt'
    ])
      expect(JSON.parse(text).connections[0]).not.toHaveProperty(key)
    expect(row.input.password).toBeUndefined()
    expect(original).toEqual(snapshot)
  })

  it('supports optionally encrypting a secret-free backup', async () => {
    const text = await encodeConnections([input()], 'amdm', false, passphrase)
    await expect(decodeConnections(text)).rejects.toThrow('passwordRequired')
    expect((await decodeConnections(text, passphrase))[0].input.password).toBeUndefined()
  })

  it('uses fresh salt and IV and rejects a wrong password or modified ciphertext', async () => {
    const a = JSON.parse(await encodeConnections([input()], 'amdm', true, passphrase))
    const b = JSON.parse(await encodeConnections([input()], 'amdm', true, passphrase))
    expect(a.encryption.salt).not.toBe(b.encryption.salt)
    expect(a.encryption.iv).not.toBe(b.encryption.iv)
    await expect(decodeConnections(JSON.stringify(a), 'wrong')).rejects.toThrow(/^invalidPassword$/)
    const ciphertext = Buffer.from(a.ciphertext, 'base64')
    ciphertext[0] ^= 1
    a.ciphertext = ciphertext.toString('base64')
    await expect(decodeConnections(JSON.stringify(a), passphrase)).rejects.toThrow(
      /^invalidPassword$/
    )
  })

  it.each([
    ['N', 2 ** 30],
    ['N', 16384],
    ['r', 1024],
    ['p', 9999],
    ['cipher', 'aes-256-cbc'],
    ['kdf', 'pbkdf2'],
    ['iv', 'AA=='],
    ['salt', 'AA=='],
    ['tag', 'AA=='],
    ['salt', 'not base64']
  ])(
    'rejects untrusted encryption parameter %s before asking for a password',
    async (key, value) => {
      const envelope = {
        type: 'AMDM Connections',
        version: 1,
        encrypted: true,
        encryption: {
          cipher: 'aes-256-gcm',
          kdf: 'scrypt',
          N: 32768,
          r: 8,
          p: 1,
          salt: Buffer.alloc(16).toString('base64'),
          iv: Buffer.alloc(12).toString('base64'),
          tag: Buffer.alloc(16).toString('base64'),
          [key]: value
        },
        ciphertext: 'AA=='
      }
      await expect(decodeConnections(JSON.stringify(envelope))).rejects.toThrow(
        /^invalidEncryptionParameters$/
      )
    }
  )

  it('handles a large base64 ciphertext without a recursive regular expression', async () => {
    const original = input({
      options: Object.fromEntries(
        Array.from({ length: 160 }, (_, n) => [`futureOption${n}`, 'x'.repeat(8000)])
      )
    })
    const text = await encodeConnections([original], 'amdm', true, passphrase)
    const [row] = await decodeConnections(text, passphrase)
    expect(row.input.options).toEqual(original.options)
  })
})

describe('MongoDB URI transfer semantics', () => {
  it('preserves seeds, IPv6, TLS files, SCRAM mechanism, credentials and database', async () => {
    const original = input({
      host: 'db:27018,[::1]:27019',
      tls: {
        enabled: true,
        caFile: '/a path/ca.pem',
        certificateKeyFile: 'C:\\cert.pem',
        allowInvalidCertificates: true
      },
      options: { readPreference: 'secondaryPreferred', retryWrites: 'false' }
    })
    const uri = mongoUriForTransfer(original, true)
    const [row] = await decodeConnections(uri)
    expect(row.error).toBeUndefined()
    expect(row.input).toMatchObject({
      host: original.host,
      password,
      defaultDatabase: 'app',
      replicaSet: 'rs0',
      auth: original.auth,
      tls: original.tls,
      options: { readPreference: 'secondaryPreferred', retryWrites: 'false' }
    })
    expect(row.warnings).toEqual(['externalFiles'])
    expect(uri).not.toContain(password)
  })

  it('omits the password rather than exporting a placeholder', async () => {
    const uri = mongoUriForTransfer(input(), false)
    expect(uri).not.toContain('password')
    expect((await decodeConnections(uri))[0].input.password).toBeUndefined()
    expect(mongoUriForTransfer(input({ password: '' }), true)).toContain(':@')
  })

  it('exports application default authSource=admin even when the URI has a database path', async () => {
    const uri = mongoUriForTransfer(
      input({ auth: { type: 'scram', username: 'me', authSource: '' } }),
      false
    )
    expect(uri).toContain('authSource=admin')
    expect((await decodeConnections(uri))[0].input.auth.authSource).toBe('admin')
  })

  it('imports URI path authentication semantics and case-insensitive mapped keys', async () => {
    const [row] = await decodeConnections(
      'mongodb://user:pass@db/path?REPLICASET=RS&AUTHSOURCE=other&AUTHMECHANISM=SCRAM-SHA-1&TLS=TRUE'
    )
    expect(row.input).toMatchObject({
      replicaSet: 'RS',
      auth: { type: 'scram', username: 'user', authSource: 'other', mechanism: 'SCRAM-SHA-1' },
      tls: { enabled: true }
    })
    expect((await decodeConnections('mongodb://user@db/path'))[0].input.auth.authSource).toBe(
      'path'
    )
    expect((await decodeConnections('mongodb://user@db'))[0].input.auth.authSource).toBe('admin')
  })

  it.each(['SCRAM-SHA-1', 'SCRAM-SHA-256', 'DEFAULT'])(
    'preserves supported mechanism %s',
    async (mechanism) => {
      const [row] = await decodeConnections(`mongodb://user@db/?authMechanism=${mechanism}`)
      expect(row.input.auth.mechanism).toBe(mechanism)
    }
  )

  it.each(['MONGODB-X509', 'GSSAPI', 'PLAIN', 'MONGODB-AWS', 'MONGODB-OIDC', 'scram-sha-256'])(
    'rejects unsupported mechanism %s',
    async (mechanism) => {
      const [row] = await decodeConnections(
        `mongodb://user:dont-leak-me@db/?authMechanism=${mechanism}`
      )
      expect(row.error).toBe('unsupportedAuthMechanism')
      expectSafeRows([row])
    }
  )

  it('preserves certificate-only validation flags without disabling hostname checks', async () => {
    const [row] = await decodeConnections('mongodb://db/?tls=true&tlsAllowInvalidCertificates=true')
    expect(row.input.tls.allowInvalidCertificates).toBe(false)
    expect(row.input.options).toEqual({ tlsAllowInvalidCertificates: 'true' })
    expect(mongoUriForTransfer(row.input, false)).not.toContain('tlsAllowInvalidHostnames')
  })

  it('preserves the implicit SRV TLS default and explicit disabling of TLS', async () => {
    const [normal] = await decodeConnections('mongodb+srv://cluster.example.com')
    expect(normal.input.tls.enabled).toBe(true)
    const [disabled] = await decodeConnections('mongodb+srv://cluster.example.com/?tls=false')
    expect(disabled.input.options).toEqual({ tls: 'false' })
    expect(mongoUriForTransfer(disabled.input, false)).toContain('tls=false')
  })

  it('does not duplicate dedicated options when extra options override them', async () => {
    const uri = mongoUriForTransfer(
      input({ tls: { enabled: true }, options: { replicaSet: 'override', tls: 'false' } }),
      false
    )
    expect(uri.match(/replicaSet=/g)).toHaveLength(1)
    expect(uri.match(/tls=/g)).toHaveLength(1)
    expect((await decodeConnections(uri))[0].input).toMatchObject({
      replicaSet: 'override',
      tls: { enabled: false }
    })
  })

  it.each(['urls', 'studio3t', 'nosqlbooster', 'robo3t'] as const)(
    'uses standard URI lines for %s',
    async (format) => {
      const text = await encodeConnections([input(), input({ host: 'second' })], format, true)
      expect(text.split('\n')).toHaveLength(2)
      expect(
        (
          await decodeConnections(
            '\uFEFF# connection list\r\n' + text.replaceAll('\n', '\r\n') + '\r\n// end\r\n'
          )
        ).every((row) => !row.error)
      ).toBe(true)
    }
  )

  it('rejects lossy export of unrecognized saved options outside AMDM', async () => {
    const original = input({ options: { futureDriverOption: 'unchanged' } })
    expect(() => mongoUriForTransfer(original, true)).toThrow(/^unsupportedOptions$/)
    await expect(encodeConnections([original], 'compass', false)).rejects.toThrow(
      /^unsupportedOptions$/
    )
    const [row] = await decodeConnections(await encodeConnections([original], 'amdm', false))
    expect(row.input.options).toEqual(original.options)
  })

  it('warns before dropping unknown non-sensitive URI options', async () => {
    const [row] = await decodeConnections('mongodb://db/?futureOption=value')
    expect(row.error).toBeUndefined()
    expect(row.warnings).toEqual(['unsupportedOptions:futureOption'])
    expect(row.input.options).toBeUndefined()
  })
})

describe('Compass Connections EJSON v1', () => {
  it('imports an independent upstream-compatible encrypted fixture with encoded password', async () => {
    const encrypted = upstreamEncrypt({
      password: encodeURIComponent(password),
      sshTunnelPassword: 'ssh\npassword',
      sshTunnelPassphrase: 'key\nphrase'
    })
    const text = compass([
      compassRow(undefined, {
        connectionOptions: {
          connectionString: 'mongodb://user@db/app?authSource=admin',
          sshTunnel: { host: 'ssh', port: 2222, username: 'me', identityKeyFile: ['/key'] }
        },
        connectionSecrets: encrypted
      })
    ])
    await expect(decodeConnections(text)).rejects.toThrow(/^passwordRequired$/)
    const [row] = await decodeConnections(text, passphrase)
    expect(row.error).toBeUndefined()
    expect(row.input).toMatchObject({
      id: '',
      name: 'Compass',
      color: '#3b82f6',
      password,
      sshPassword: 'ssh\npassword',
      sshPassphrase: 'key\nphrase',
      ssh: {
        enabled: true,
        host: 'ssh',
        port: 2222,
        authMethod: 'privateKey',
        privateKeyPath: '/key'
      }
    })
    expect(row.warnings).toEqual(['externalFiles'])
  })

  it('exports encrypted secrets consumable by an independent upstream decrypter', async () => {
    const text = await encodeConnections(
      [
        input({
          ssh: { enabled: true, host: 'ssh', username: 'me', authMethod: 'password' },
          sshPassword: 'ssh\nsecret'
        })
      ],
      'compass',
      true,
      passphrase
    )
    const payload = EJSON.parse(text)
    const row = payload.connections[0]
    expect(upstreamDecrypt(row.connectionSecrets)).toEqual({
      password: encodeURIComponent(password),
      sshTunnelPassword: 'ssh\nsecret'
    })
    expect(row.connectionOptions.connectionString).not.toContain(encodeURIComponent(password))
    expect(row.connectionOptions.sshTunnel.password).toBeUndefined()
    expect(row.id).not.toBe('existing-id')
    expect((await decodeConnections(text, passphrase))[0].input.password).toBe(password)
  })

  it('supports canonical EJSON numbers for version and SSH port, and plaintext secrets', async () => {
    const text = await encodeConnections(
      [
        input({
          ssh: {
            enabled: true,
            host: 'ssh',
            port: 2222,
            username: 'me',
            authMethod: 'privateKey',
            privateKeyPath: '/key'
          },
          sshPassphrase: 'key\nphrase'
        })
      ],
      'compass',
      true
    )
    expect(text).toContain('$numberInt')
    const [row] = await decodeConnections(text)
    expect(row.error).toBeUndefined()
    expect(row.input).toMatchObject({ password, sshPassphrase: 'key\nphrase', ssh: { port: 2222 } })
  })

  it('removes secrets without a passphrase and preserves SSH and TLS paths', async () => {
    const text = await encodeConnections(
      [
        input({
          ssh: { enabled: true, host: 'ssh', username: 'me', authMethod: 'password' },
          sshPassword: 'ssh-secret',
          tls: { enabled: true, caFile: '/ca' }
        })
      ],
      'compass',
      false,
      passphrase
    )
    expect(text).not.toContain('connectionSecrets')
    expect(text).not.toContain('ssh-secret')
    const [row] = await decodeConnections(text)
    expect(row.input.password).toBeUndefined()
    expect(row.input.ssh.enabled).toBe(true)
    expect(row.input.tls.caFile).toBe('/ca')
  })

  it('stops the whole import on a wrong password even after an earlier valid row', async () => {
    const text = compass([
      compassRow(),
      compassRow(undefined, { connectionSecrets: upstreamEncrypt({ password: 'dont-leak-me' }) })
    ])
    await expect(decodeConnections(text, 'incorrect')).rejects.toThrow(/^invalidPassword$/)
  })

  it('rejects a tampered authentication tag and unsupported encrypted binary version', async () => {
    const bytes = Buffer.from(upstreamEncrypt({ password: 'secret' }), 'base64')
    bytes[34] ^= 1
    await expect(
      decodeConnections(
        compass([compassRow(undefined, { connectionSecrets: bytes.toString('base64') })]),
        passphrase
      )
    ).rejects.toThrow(/^invalidPassword$/)
    bytes[1] = 2
    await expect(
      decodeConnections(
        compass([compassRow(undefined, { connectionSecrets: bytes.toString('base64') })]),
        passphrase
      )
    ).rejects.toThrow(/^invalidEncryptionParameters$/)
  })

  it('rejects unsupported secret types and avoids importing unsafe connection options', async () => {
    const [row] = await decodeConnections(
      compass([
        compassRow(undefined, {
          connectionSecrets: upstreamEncrypt({ tlsCertificateKeyFilePassword: 'dont-leak-me' })
        })
      ]),
      passphrase
    )
    expect(row.error).toBe('unsupportedOptions')
    expectSafeRows([row])
    const [oidc] = await decodeConnections(
      compass([
        compassRow(undefined, {
          connectionOptions: { connectionString: 'mongodb://db', oidc: { token: 'dont-leak-me' } }
        })
      ])
    )
    expect(oidc.error).toBe('unsupportedOptions')
    expectSafeRows([oidc])
  })

  it('rejects malformed rows independently', async () => {
    const rows = await decodeConnections(compass([null, compassRow(), { connectionOptions: {} }]))
    expect(rows.map((row) => !!row.error)).toEqual([true, false, true])
    expectSafeRows(rows)
  })
})

describe('native Robo3T settings', () => {
  it('imports upstream native replica-set numeric member keys and legacy plaintext secrets', async () => {
    const rows = await decodeConnections(
      robo([
        {
          connectionName: 'Robo',
          serverHost: 'fallback',
          serverPort: 27017,
          defaultDatabase: 'app',
          isReplicaSet: true,
          replicaSet: {
            setNameUserEntered: 'rs',
            cachedSetName: 'cached',
            0: 'a:27017',
            1: '[::1]:27018',
            readPreference: 3
          },
          credentials: [
            {
              enabled: true,
              userName: 'me',
              userPassword: 'plain\nsecret',
              databaseName: 'admin',
              mechanism: 'SCRAM-SHA-1',
              useManuallyVisibleDbs: true
            }
          ],
          ssh: {
            enabled: true,
            host: 'ssh',
            port: 22,
            userName: 'sshuser',
            method: 'publickey',
            privateKeyFile: '/key',
            passphrase: 'key\nphrase'
          },
          ssl: {
            sslEnabled: true,
            usePemFile: true,
            pemKeyFile: '/client',
            caFile: '/ca',
            allowInvalidCertificates: true,
            allowInvalidHostnames: false
          }
        }
      ])
    )
    expect(rows[0].error).toBeUndefined()
    expect(rows[0].input).toMatchObject({
      id: '',
      name: 'Robo',
      host: 'a:27017,[::1]:27018',
      replicaSet: 'rs',
      password: 'plain\nsecret',
      sshPassphrase: 'key\nphrase',
      options: {
        readPreference: 'secondaryPreferred',
        tlsAllowInvalidCertificates: 'true',
        tlsAllowInvalidHostnames: 'false'
      },
      auth: { mechanism: 'SCRAM-SHA-1' },
      tls: { certificateKeyFile: '/client', caFile: '/ca', allowInvalidCertificates: false }
    })
    expect(rows[0].warnings).toEqual(['unsupportedDatabaseFilter', 'externalFiles'])
  })

  it('flags encrypted native credentials and never treats ciphertext as a password', async () => {
    const [row] = await decodeConnections(
      robo([
        {
          connectionName: 'Robo',
          serverHost: 'db',
          credentials: [{ enabled: true, userName: 'user', userPasswordEncrypted: 'dont-leak-me' }],
          ssh: {
            enabled: true,
            host: 'ssh',
            userName: 'me',
            method: 'password',
            userPasswordEncrypted: 'dont-leak-me',
            passphraseEncrypted: 'dont-leak-me'
          }
        }
      ])
    )
    expect(row.error).toBeUndefined()
    expect(row.warnings).toEqual(['encryptedSecretsOmitted'])
    expect(row.input.password).toBeUndefined()
    expect(row.input.sshPassword).toBeUndefined()
    expect(row.input.sshPassphrase).toBeUndefined()
    expect(JSON.stringify(row)).not.toContain('dont-leak-me')
  })

  it('prefers legacy plaintext fields exactly as the native loader does', async () => {
    const [row] = await decodeConnections(
      robo([
        {
          serverHost: 'db',
          credentials: [
            { enabled: true, userName: 'user', userPassword: '', userPasswordEncrypted: 'unused' }
          ]
        }
      ])
    )
    expect(row.input.password).toBe('')
    expect(row.warnings).not.toContain('encryptedSecretsOmitted')
  })

  it('rejects multiple active credentials and unsupported PEM passphrases', async () => {
    const rows = await decodeConnections(
      robo([
        {
          serverHost: 'db',
          credentials: [
            { enabled: true, userName: 'a' },
            { enabled: true, userName: 'b' }
          ]
        },
        { serverHost: 'db', ssl: { sslEnabled: true, pemPassPhraseEncrypted: 'dont-leak-me' } }
      ])
    )
    expect(rows.map((row) => row.error)).toEqual([
      'unsupportedMultipleCredentials',
      'unsupportedTlsOptions'
    ])
    expectSafeRows(rows)
  })
})

describe('bounds, validation, and stable safe diagnostics', () => {
  it('accepts exactly 10000 connections and rejects more before visiting rows', async () => {
    const text = Array(10_000).fill('mongodb://db').join('\n')
    expect(await decodeConnections(text)).toHaveLength(10_000)
    await expect(decodeConnections(text + '\nmongodb://db')).rejects.toThrow(/^tooManyConnections$/)
    await expect(decodeConnections(amdm(Array(10_001).fill(null)))).rejects.toThrow(
      /^tooManyConnections$/
    )
    await expect(decodeConnections(compass(Array(10_001).fill(null)))).rejects.toThrow(
      /^tooManyConnections$/
    )
    await expect(encodeConnections(Array(10_001).fill(input()), 'amdm', false)).rejects.toThrow(
      /^tooManyConnections$/
    )
  })

  it.each([
    ['', 'unsupportedFormat'],
    ['hello dont-leak-me', 'unsupportedFormat'],
    ['{bad dont-leak-me', 'invalidFile'],
    ['[]', 'unsupportedFormat'],
    ['{"type":"unrecognized"}', 'unsupportedFormat'],
    ['{"type":"AMDM Connections","version":2,"connections":[]}', 'unsupportedVersion'],
    ['{"type":"Compass Connections","version":2,"connections":[]}', 'unsupportedVersion'],
    ['{"type":"AMDM Connections","version":1,"connections":{}}', 'invalidFile'],
    ['{"type":"AMDM Connections","version":1,"encrypted":"yes","connections":[]}', 'invalidFile']
  ])('classifies malformed input without parser messages: %s', async (text, code) => {
    await expect(decodeConnections(text)).rejects.toThrow(new RegExp(`^${code}$`))
  })

  it.each([
    'password',
    'tlsCertificateKeyFilePassword',
    'proxyPassword',
    'passphrase',
    'token',
    'clientSecret',
    'authMechanismProperties',
    '__proto__',
    'constructor'
  ])('rejects sensitive or prototype-mutating option %s', async (key) => {
    const original = input({ options: Object.fromEntries([[key, 'dont-leak-me']]) })
    await expect(encodeConnections([original], 'amdm', false)).rejects.toThrow(
      /^unsupportedOptions$/
    )
    const [row] = await decodeConnections(amdm([original]))
    expect(row.error).toBe('unsupportedOptions')
    expectSafeRows([row])
    if (!['__proto__', 'constructor'].includes(key)) {
      const [uri] = await decodeConnections(`mongodb://db/?${key}=dont-leak-me`)
      expect(uri.error).toBe('unsupportedOptions')
      expectSafeRows([uri])
    }
  })

  it('rejects malformed fields, unsafe object options, bad hosts, ports and duplicate URI options per row', async () => {
    const bad = [
      null,
      input({ port: 0 }),
      input({ port: 65536 }),
      input({ host: 'db:12junk' }),
      input({ host: 'user:dont-leak-me@host' }),
      { ...input(), options: { retryWrites: { dont: 'dont-leak-me' } } },
      { ...input(), auth: { type: 'x509' } },
      { ...input(), ssh: { enabled: true, authMethod: 'agent' } }
    ]
    const rows = await decodeConnections(amdm([...bad, input()]))
    expect(rows.slice(0, -1).every((row) => !!row.error)).toBe(true)
    expect(rows.at(-1)?.error).toBeUndefined()
    expectSafeRows(rows)
    const uriRows = await decodeConnections(
      'mongodb://db/?tls=true&TLS=false\nmongodb://db/?tls=maybe\nmongodb://user:dont-leak-me@db:99999\nmongodb://db'
    )
    expect(uriRows.map((row) => !!row.error)).toEqual([true, true, true, false])
    expectSafeRows(uriRows)
  })

  it('warns on unknown fields but never copies them into inputs', async () => {
    const [row] = await decodeConnections(
      amdm([
        {
          ...input(),
          extra: { token: 'dont-leak-me' },
          auth: { type: 'none', extra: 'dont-leak-me' },
          password: undefined
        }
      ])
    )
    expect(row.error).toBeUndefined()
    expect(row.warnings).toEqual(['unsupportedFields:extra'])
    expect(JSON.stringify(row)).not.toContain('dont-leak-me')
  })

  it('retains valid rows alongside invalid lines without leaking the failed URI', async () => {
    const rows = await decodeConnections(
      'mongodb://db\nnot a URI dont-leak-me\nmongodb://user:dont-leak-me@\nmongodb://other'
    )
    expect(rows.map((row) => !!row.error)).toEqual([false, true, true, false])
    expectSafeRows(rows)
  })

  it('reports format-specific losses and external file dependencies as stable warnings', () => {
    const original = input({
      ssh: {
        enabled: true,
        host: 'ssh',
        username: 'me',
        privateKeyPath: '/key',
        pinnedHostKey: 'pinned',
        jump: { host: 'jump', username: 'me', privateKeyPath: '/jump' }
      },
      tls: { enabled: true, caFile: '/ca' }
    })
    expect(connectionTransferWarnings(original, 'amdm')).toEqual(['externalFiles'])
    expect(connectionTransferWarnings(input({options: { readPreference: 'nearest' }}), 'robo3t')).toContain('roboOptionsUnsupported:readPreference')
    expect(connectionTransferWarnings(original, 'urls')).toEqual([
      'externalFiles',
      'sshOmitted',
      'nameOmitted',
      'colorOmitted'
    ])
    expect(connectionTransferWarnings(original, 'compass')).toEqual([
      'externalFiles',
      'sshJumpOmitted',
      'sshHostKeyOmitted'
    ])
  })
})
