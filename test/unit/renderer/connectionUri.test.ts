/**
 * MongoDB connection-string parse/build for the connection form.
 */
import { describe, it, expect } from 'vitest'
import { parseMongoUri, buildMongoUri } from '@renderer/lib/connectionUri'

describe('parseMongoUri', () => {
  it('parses a basic mongodb:// URI', () => {
    const p = parseMongoUri('mongodb://host:27017/mydb')
    expect(p).toMatchObject({
      useSrv: false,
      host: 'host',
      port: 27017,
      defaultDatabase: 'mydb',
      hasAuth: false,
      password: null
    })
  })
  it('parses auth + mapped query options', () => {
    const p = parseMongoUri('mongodb://user:pass@host:27017/db?replicaSet=rs0&authSource=admin&tls=true')
    expect(p).toMatchObject({
      hasAuth: true,
      username: 'user',
      password: 'pass',
      replicaSet: 'rs0',
      authSource: 'admin',
      tlsEnabled: true
    })
    expect(p.extraOptions).toEqual({}) // mapped keys are not duplicated here
  })
  it('treats mongodb+srv as host-only (no port)', () => {
    const p = parseMongoUri('mongodb+srv://user@cluster0.ex.mongodb.net/db')
    expect(p).toMatchObject({
      useSrv: true,
      host: 'cluster0.ex.mongodb.net',
      port: null,
      username: 'user',
      password: null
    })
  })
  it('parses an IPv6 literal host', () => {
    const p = parseMongoUri('mongodb://[::1]:27017/db')
    expect(p).toMatchObject({ host: '::1', port: 27017 })
  })
  it('handles a missing port', () => {
    expect(parseMongoUri('mongodb://host/db').port).toBeNull()
  })
  it('percent-decodes userinfo', () => {
    const p = parseMongoUri('mongodb://us%40er:p%3Ass@host/')
    expect(p).toMatchObject({ username: 'us@er', password: 'p:ss' })
  })
  it('captures unmapped options in extraOptions', () => {
    const p = parseMongoUri('mongodb://host/?retryWrites=true&w=majority')
    expect(p.extraOptions).toEqual({ retryWrites: 'true', w: 'majority' })
  })
  it('preserves every host in a seed list', () => {
    const p = parseMongoUri('mongodb://h1:1,h2:2/db')
    expect(p).toMatchObject({ host: 'h1', port: 1 })
    expect(p.hosts).toEqual(['h1:1', 'h2:2'])
  })
  it('preserves the full replica-set URI from the reported failure', () => {
    const p = parseMongoUri(
      'mongodb://foo:bar@db1.ezze.live:5001,db2.ezze.live:5001,db2.ezze.live:5003/ezze?retryWrites=true&replicaSet=PROD'
    )
    expect(p).toMatchObject({
      hosts: ['db1.ezze.live:5001', 'db2.ezze.live:5001', 'db2.ezze.live:5003'],
      username: 'foo',
      password: 'bar',
      defaultDatabase: 'ezze',
      authSource: 'ezze',
      replicaSet: 'PROD',
      extraOptions: { retryWrites: 'true' }
    })
  })
  it('reads tlsAllowInvalidCertificates / tlsInsecure', () => {
    expect(parseMongoUri('mongodb://host/?tlsAllowInvalidCertificates=true').tlsAllowInvalid).toBe(true)
    expect(parseMongoUri('mongodb://host/?tlsInsecure=true').tlsAllowInvalid).toBe(true)
  })
  it('throws on a non-mongodb scheme and on a missing host', () => {
    expect(() => parseMongoUri('http://x')).toThrow()
    expect(() => parseMongoUri('mongodb:///db')).toThrow()
  })
  it('validates SRV host rules and reads option names case-insensitively', () => {
    expect(() => parseMongoUri('mongodb+srv://h1,h2/db')).toThrow()
    expect(() => parseMongoUri('mongodb+srv://h:27017/db')).toThrow()
    expect(parseMongoUri('mongodb://h/db?ReplicaSet=RS&TLS=TRUE')).toMatchObject({
      replicaSet: 'RS',
      tlsEnabled: true
    })
  })
})

describe('buildMongoUri', () => {
  const base = { tlsEnabled: false, tlsAllowInvalid: false } as const
  it('builds a minimal URI', () => {
    expect(buildMongoUri({ ...base, useSrv: false, host: 'h', port: 27017, authType: 'none' })).toBe(
      'mongodb://h:27017'
    )
  })
  it('builds auth + db + options', () => {
    expect(
      buildMongoUri({
        useSrv: false,
        host: 'h',
        port: 27017,
        authType: 'scram',
        username: 'u',
        password: 'p',
        authSource: 'admin',
        defaultDatabase: 'db',
        replicaSet: 'rs0',
        tlsEnabled: true,
        tlsAllowInvalid: false
      })
    ).toBe('mongodb://u:p@h:27017/db?replicaSet=rs0&authSource=admin&tls=true')
  })
  it('omits the port for mongodb+srv', () => {
    expect(
      buildMongoUri({ ...base, useSrv: true, host: 'c.net', port: 27017, authType: 'none' })
    ).toBe('mongodb+srv://c.net')
  })
  it('builds complete seed lists and brackets legacy IPv6 hosts', () => {
    expect(
      buildMongoUri({
        ...base,
        useSrv: false,
        host: 'h1:5001,h2:5002',
        authType: 'none'
      })
    ).toBe('mongodb://h1:5001,h2:5002')
    expect(
      buildMongoUri({ ...base, useSrv: false, host: '::1', port: 27017, authType: 'none' })
    ).toBe('mongodb://[::1]:27017')
  })
  it('percent-encodes userinfo', () => {
    expect(
      buildMongoUri({ ...base, useSrv: false, host: 'h', authType: 'scram', username: 'us@er', password: 'p:ss' })
    ).toBe('mongodb://us%40er:p%3Ass@h')
  })
})

describe('parse ∘ build round-trips the key fields', () => {
  it('preserves host/port/auth/db/options', () => {
    const uri = buildMongoUri({
      useSrv: false,
      host: 'db.example.com',
      port: 27018,
      authType: 'scram',
      username: 'admin',
      password: 's3cr#t',
      authSource: 'admin',
      defaultDatabase: 'app',
      replicaSet: 'rs1',
      tlsEnabled: true,
      tlsAllowInvalid: true,
      options: { w: 'majority' }
    })
    expect(parseMongoUri(uri)).toMatchObject({
      host: 'db.example.com',
      port: 27018,
      username: 'admin',
      password: 's3cr#t',
      authSource: 'admin',
      defaultDatabase: 'app',
      replicaSet: 'rs1',
      tlsEnabled: true,
      tlsAllowInvalid: true,
      extraOptions: { w: 'majority' }
    })
  })
})
