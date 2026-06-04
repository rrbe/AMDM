/**
 * MongoClient URI + options construction from a connection config.
 */
import { describe, it, expect } from 'vitest'
import { buildClientArgs, type DecryptedConnection } from '../../../src/main/mongo/uri'
import type { ConnectionConfig } from '../../../src/shared/types'

const cfg = (over: Partial<ConnectionConfig> = {}): ConnectionConfig => ({
  id: 'c1',
  name: 'conn',
  useSrv: false,
  host: 'db.example.com',
  port: 27017,
  auth: { type: 'none' },
  ssh: { enabled: false },
  tls: { enabled: false },
  createdAt: 0,
  updatedAt: 0,
  ...over
})

const dec = (config: ConnectionConfig, secrets: Partial<DecryptedConnection> = {}): DecryptedConnection => ({
  config,
  ...secrets
})

describe('buildClientArgs — host / topology', () => {
  it('builds a basic mongodb:// URI with timeouts', () => {
    const { uri, options } = buildClientArgs(dec(cfg()))
    expect(uri).toBe('mongodb://db.example.com:27017')
    expect(options).toMatchObject({ serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 })
  })
  it('defaults the port to 27017', () => {
    expect(buildClientArgs(dec(cfg({ port: undefined }))).uri).toBe('mongodb://db.example.com:27017')
  })
  it('sets replicaSet for a non-SRV host', () => {
    expect(buildClientArgs(dec(cfg({ replicaSet: 'rs0' }))).options.replicaSet).toBe('rs0')
  })
  it('builds a mongodb+srv:// URI without a port', () => {
    expect(buildClientArgs(dec(cfg({ useSrv: true, host: 'cluster0.mongodb.net' }))).uri).toBe(
      'mongodb+srv://cluster0.mongodb.net'
    )
  })
})

describe('buildClientArgs — SSH tunnel redirection', () => {
  it('points at 127.0.0.1:<port> with directConnection, skipping replicaSet', () => {
    const { uri, options } = buildClientArgs(dec(cfg({ replicaSet: 'rs0' })), 19876)
    expect(uri).toBe('mongodb://127.0.0.1:19876')
    expect(options.directConnection).toBe(true)
    expect(options.replicaSet).toBeUndefined()
  })
})

describe('buildClientArgs — auth', () => {
  it('maps SCRAM credentials, authSource and mechanism', () => {
    const { options } = buildClientArgs(
      dec(cfg({ auth: { type: 'scram', username: 'u', authSource: 'app', mechanism: 'SCRAM-SHA-256' } }), {
        password: 'p'
      })
    )
    expect(options.auth).toEqual({ username: 'u', password: 'p' })
    expect(options.authSource).toBe('app')
    expect(options.authMechanism).toBe('SCRAM-SHA-256')
  })
  it('defaults authSource to admin and omits a DEFAULT mechanism', () => {
    const { options } = buildClientArgs(
      dec(cfg({ auth: { type: 'scram', username: 'u', mechanism: 'DEFAULT' } }))
    )
    expect(options.authSource).toBe('admin')
    expect(options.authMechanism).toBeUndefined()
    expect(options.auth).toEqual({ username: 'u', password: '' }) // missing secret → empty
  })
})

describe('buildClientArgs — TLS + extra options', () => {
  it('maps TLS flags and file paths', () => {
    const { options } = buildClientArgs(
      dec(
        cfg({
          tls: {
            enabled: true,
            allowInvalidCertificates: true,
            caFile: '/ca.pem',
            certificateKeyFile: '/ck.pem'
          }
        })
      )
    )
    expect(options).toMatchObject({
      tls: true,
      tlsAllowInvalidCertificates: true,
      tlsAllowInvalidHostnames: true,
      tlsCAFile: '/ca.pem',
      tlsCertificateKeyFile: '/ck.pem'
    })
  })
  it('passes through extra string options', () => {
    const { options } = buildClientArgs(dec(cfg({ options: { readPreference: 'secondaryPreferred' } })))
    expect((options as Record<string, unknown>).readPreference).toBe('secondaryPreferred')
  })
})
