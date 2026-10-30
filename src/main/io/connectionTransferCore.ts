/**
 * Main-only, side-effect-free connection transfer codecs. Never forward these
 * records to the renderer: they can contain plaintext credentials.
 *
 * Compatibility references (formats, not dependencies), inspected at:
 * Compass commit 0bcef5ae094a4e866695de71139cc84494f5807d:
 * https://github.com/mongodb-js/compass/blob/0bcef5ae094a4e866695de71139cc84494f5807d/packages/connection-storage/src/encrypt.ts
 * https://github.com/mongodb-js/compass/blob/0bcef5ae094a4e866695de71139cc84494f5807d/packages/connection-storage/src/import-export-connection.ts
 * https://github.com/mongodb-js/compass/blob/0bcef5ae094a4e866695de71139cc84494f5807d/packages/connection-info/src/connection-secrets.ts
 * Robo3T commit 4ad11c6686fb23b65535899df26f1cbce72cb786:
 * https://github.com/Studio3T/robomongo/tree/4ad11c6686fb23b65535899df26f1cbce72cb786/src/robomongo/core/settings
 * https://github.com/Studio3T/robomongo/blob/4ad11c6686fb23b65535899df26f1cbce72cb786/src/robomongo/gui/dialogs/ConnectionBasicTab.cpp
 * URI interchange:
 * https://studio3t.com/knowledge-base/desktop-ide/connect-to-mongodb/
 * https://nosqlbooster.com/blog/announcing-nosqlbooster-90/index.html
 *
 * AMDM retains opaque non-sensitive string options verbatim, including casing.
 * URI/Compass export rejects unknown option names instead of losing settings.
 * URI imports warn before omitting unknown non-sensitive options. Secret-bearing
 * keys and prototype-mutating keys are rejected for every format.
 *
 * Formats:
 * - Compass: mongodb-js/compass packages/connection-storage/src/{encrypt,
 *   import-export-connection}.ts and connection-info/src/connection-secrets.ts.
 *   EJSON v1; PBKDF2-SHA512/100000; AES-256-GCM; binary layout
 *   uint16be(1) | salt(16) | IV(16) | tag(16) | ciphertext. URI passwords
 *   inside `secrets.password` are already percent-encoded, not plaintext.
 * - Robo3T: Studio3T/robomongo core/settings/*Settings.cpp. Native encrypted
 *   credentials are not portable here; warn and require re-entry. Replica-set
 *   members use numeric object keys, not an array. Native export is not offered.
 *   ConnectionBasicTab.cpp on_uriButton_clicked applies only its dedicated URI
 *   fields; general options may be ignored (roboOptionsUnsupported warning).
 * - Studio3T .uri and NoSQLBooster URI lists use ordinary MongoDB URI lines;
 *   vendor SSH extensions and proprietary connection archives are not supported.
 *
 * AMDM v1 encrypts the entire inner { type, version, connections } payload.
 * Its single accepted scrypt profile is N=32768, r=8, p=1, keyLength=32,
 * maxmem=64MiB; untrusted input cannot choose larger work factors. Salt=16,
 * IV=12, GCM tag=16 bytes. The fixed outer type/version is authenticated as AAD.
 * The file adapter reads/writes files and enforces the 16MiB file limit.
 */
import {
  createCipheriv,
  createDecipheriv,
  pbkdf2,
  randomBytes,
  randomUUID,
  scrypt
} from 'node:crypto'
import { promisify } from 'node:util'
import { EJSON } from 'bson'
import { buildMongoUri, parseMongoUri, formatMongoHosts } from '../../shared/connectionUri'
import type { ConnectionInput, SshConfig, TlsConfig } from '../../shared/types'
import type { ConnectionTransferFormat } from '../../shared/connectionTransfer'

export type TransferFormat = ConnectionTransferFormat
export interface TransferRecord {
  input: ConnectionInput
  warnings: string[]
  error?: string
}

export const CONNECTION_TRANSFER_ERROR_CODES = [
  'passwordRequired',
  'invalidPassword',
  'unsupportedFormat',
  'unsupportedVersion',
  'invalidFile',
  'tooManyConnections',
  'invalidEncryptionParameters',
  'invalidConnection',
  'invalidUri',
  'unsupportedAuthMechanism',
  'unsupportedOptions',
  'unsupportedTlsOptions',
  'unsupportedSshOptions',
  'unsupportedMultipleCredentials'
] as const
export const CONNECTION_TRANSFER_WARNING_CODES = [
  'roboOptionsUnsupported',
  'sshOmitted',
  'sshJumpOmitted',
  'sshHostKeyOmitted',
  'externalFiles',
  'nameOmitted',
  'colorOmitted',
  'unsupportedColor',
  'unsupportedOptions',
  'unsupportedFields',
  'encryptedSecretsOmitted',
  'unsupportedDatabaseFilter'
] as const
const errors = new Set<string>(CONNECTION_TRANSFER_ERROR_CODES)
const MAX_CONNECTIONS = 10_000
const AMDM_TYPE = 'AMDM Connections'
const COMPASS_TYPE = 'Compass Connections'

const pbkdf2Async = promisify(pbkdf2)
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
function deriveScrypt(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(passphrase, salt, 32, SCRYPT, (error, key) => {
      if (error) reject(new Error('invalidEncryptionParameters'))
      else resolve(key)
    })
  })
}
const AAD = Buffer.from('AMDM Connections:1')
const SECRET_FIELDS = ['password', 'sshPassword', 'sshPassphrase', 'jumpSshPassphrase'] as const
const mechanisms = new Set(['DEFAULT', 'SCRAM-SHA-1', 'SCRAM-SHA-256'])
// Explicit scalar-only allowlist. No callbacks, driver objects, auth overrides,
// arbitrary filesystem options, or credential-bearing options cross this boundary.
const optionNames = [
  'authMechanism',
  'authSource',
  'tlsCAFile',
  'tlsCertificateKeyFile',
  'appName',
  'replicaSet',
  'readPreference',
  'readPreferenceTags',
  'maxStalenessSeconds',
  'retryWrites',
  'retryReads',
  'w',
  'wtimeoutMS',
  'journal',
  'readConcernLevel',
  'connectTimeoutMS',
  'socketTimeoutMS',
  'serverSelectionTimeoutMS',
  'heartbeatFrequencyMS',
  'maxPoolSize',
  'minPoolSize',
  'maxIdleTimeMS',
  'waitQueueTimeoutMS',
  'maxConnecting',
  'compressors',
  'zlibCompressionLevel',
  'directConnection',
  'loadBalanced',
  'srvMaxHosts',
  'srvServiceName',
  'tls',
  'tlsInsecure',
  'tlsAllowInvalidCertificates',
  'tlsAllowInvalidHostnames'
]
const optionKeys = new Map(optionNames.map((key) => [key.toLowerCase(), key]))
const mappedKeys = new Set([
  'replicaset',
  'authsource',
  'authmechanism',
  'tls',
  'ssl',
  'tlsinsecure',
  'tlsallowinvalidcertificates',
  'tlsallowinvalidhostnames',
  'tlscafile',
  'tlscertificatekeyfile'
])
const sensitiveKey = /password|passphrase|token|secret|authmechanismproperties/i
const boolKeys = new Set([
  'tls',
  'ssl',
  'tlsinsecure',
  'tlsallowinvalidcertificates',
  'tlsallowinvalidhostnames',
  'retrywrites',
  'retryreads',
  'journal',
  'directconnection',
  'loadbalanced'
])
type Obj = Record<string, unknown>
function fail(code: string): never {
  throw new Error(code)
}
function obj(value: unknown): Obj {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  )
    fail('invalidConnection')
  return value as Obj
}
function string(value: unknown, fallback = '', max = 8192): string {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value))
    fail('invalidConnection')
  return value
}
function secret(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192) fail('invalidConnection')
  return value
}
function bool(value: unknown, fallback = false): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') fail('invalidConnection')
  return value
}
function port(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 65535)
    fail('invalidConnection')
  return value as number
}
function warn(warnings: string[], code: string): void {
  if (!warnings.includes(code)) warnings.push(code)
}
function warnFields(warnings: string[], code: string, fields: string[]): void {
  if (!fields.length) return
  const index = warnings.findIndex((value) => value === code || value.startsWith(code + ':'))
  const previous = index < 0 ? undefined : warnings[index]
  // Never echo values, paths, arbitrary JSON keys, or URI fragments in warnings.
  const safe = fields.every((field) => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(field))
  const value = !safe || previous === code ? code : code + ':' + [...new Set([
    ...(previous?.split(':')[1]?.split(',') ?? []), ...fields
  ])].sort().join(',')
  if (index < 0) warnings.push(value)
  else warnings[index] = value
}
function unknownFields(value: Obj, keys: string[], warnings: string[]): void {
  warnFields(warnings, 'unsupportedFields', Object.keys(value).filter((key) => !keys.includes(key)))
}
function exportHasLoss(warnings: string[]): boolean {
  return warnings.some((warning) => ['unsupportedOptions', 'unsupportedFields', 'unsupportedColor'].includes(warning.split(':')[0]))
}
function emptyInput(): ConnectionInput {
  return {
    id: '',
    name: '',
    host: '',
    useSrv: false,
    auth: { type: 'none' },
    ssh: { enabled: false },
    tls: { enabled: false }
  }
}
function safeCode(error: unknown, fallback = 'invalidConnection'): string {
  return error instanceof Error && errors.has(error.message) ? error.message : fallback
}
function count(value: unknown): unknown[] {
  if (!Array.isArray(value)) fail('invalidFile')
  if (value.length > MAX_CONNECTIONS) fail('tooManyConnections')
  return value
}
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return fail('invalidFile')
  }
}
function checkMechanism(value: unknown): ConnectionInput['auth']['mechanism'] {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || !mechanisms.has(value)) fail('unsupportedAuthMechanism')
  return value as ConnectionInput['auth']['mechanism']
}
function options(
  value: unknown,
  warnings: string[],
  preserve = false
): Record<string, string> | undefined {
  if (value === undefined) return undefined
  const result: Record<string, string> = {}
  for (const [key, val] of Object.entries(obj(value))) {
    if (
      sensitiveKey.test(key) ||
      ['constructor', 'prototype', '__proto__'].includes(key.toLowerCase())
    )
      fail('unsupportedOptions')
    if (key.toLowerCase() === 'authmechanism') checkMechanism(val)
    if (preserve) {
      if (typeof val !== 'string') fail('unsupportedOptions')
      result[key] = val
      continue
    }
    const canonical = optionKeys.get(key.toLowerCase())
    if (!canonical) {
      warnFields(warnings, 'unsupportedOptions', [key])
      continue
    }
    if (Object.hasOwn(result, canonical)) fail('unsupportedOptions')
    const s = string(val)
    if (boolKeys.has(key.toLowerCase()) && !/^(true|false)$/i.test(s)) fail('unsupportedOptions')
    result[canonical] = s
  }
  return Object.keys(result).length ? result : undefined
}
function ssh(value: unknown, warnings: string[], hop = false): SshConfig {
  const s = value === undefined ? {} : obj(value)
  unknownFields(
    s,
    [
      'enabled',
      'host',
      'port',
      'username',
      'authMethod',
      'privateKeyPath',
      'pinnedHostKey',
      ...(hop ? [] : ['jump'])
    ],
    warnings
  )
  if (
    s.authMethod !== undefined &&
    s.authMethod !== 'privateKey' &&
    (hop || s.authMethod !== 'password')
  )
    fail('unsupportedSshOptions')
  const result: SshConfig = {
    enabled: bool(s.enabled),
    host: string(s.host),
    port: port(s.port),
    username: string(s.username),
    authMethod: s.authMethod as SshConfig['authMethod'],
    privateKeyPath: string(s.privateKeyPath),
    pinnedHostKey: string(s.pinnedHostKey)
  }
  if (s.jump !== undefined && !hop) {
    const { enabled: _, ...jump } = ssh(s.jump, warnings, true)
    result.jump = { ...jump, authMethod: 'privateKey' }
  }
  return result
}
function tls(value: unknown, warnings: string[]): TlsConfig {
  const t = value === undefined ? {} : obj(value)
  unknownFields(
    t,
    ['enabled', 'allowInvalidCertificates', 'caFile', 'certificateKeyFile'],
    warnings
  )
  return {
    enabled: bool(t.enabled),
    allowInvalidCertificates: bool(t.allowInvalidCertificates),
    caFile: string(t.caFile),
    certificateKeyFile: string(t.certificateKeyFile)
  }
}
function validateHosts(input: ConnectionInput): void {
  const hosts = input.useSrv ? input.host : formatMongoHosts(input.host, input.port)
  if (!hosts || /[\s/?@#\\]/.test(hosts)) fail('invalidConnection')
  for (const seed of hosts.split(',')) {
    const match = /^(?:\[[0-9a-fA-F:.]+\]|[^:[\]]+)(?::([0-9]+))?$/.exec(seed)
    if (
      !match ||
      (match[1] &&
        (!Number.isInteger(Number(match[1])) || Number(match[1]) < 1 || Number(match[1]) > 65535))
    )
      fail('invalidConnection')
  }
  try {
    parseMongoUri(`${input.useSrv ? 'mongodb+srv' : 'mongodb'}://${hosts}`)
  } catch {
    fail('invalidConnection')
  }
}
function validateInput(
  value: unknown,
  warnings: string[],
  preserveOptions = false
): ConnectionInput {
  const s = obj(value)
  unknownFields(
    s,
    [
      'id',
      'copyFromId',
      'createdAt',
      'updatedAt',
      'hasPassword',
      'hasSshPassword',
      'hasSshPassphrase',
      'hasJumpSshPassphrase',
      'name',
      'color',
      'host',
      'port',
      'useSrv',
      'replicaSet',
      'defaultDatabase',
      'options',
      'previewResources',
      'cdnPrefix',
      'auth',
      'ssh',
      'tls',
      ...SECRET_FIELDS
    ],
    warnings
  )
  const a = s.auth === undefined ? {} : obj(s.auth)
  unknownFields(a, ['type', 'username', 'authSource', 'mechanism'], warnings)
  if (a.type !== undefined && a.type !== 'none' && a.type !== 'scram')
    fail('unsupportedAuthMechanism')
  const auth: ConnectionInput['auth'] = {
    type: (a.type ?? 'none') as 'none' | 'scram',
    username: string(a.username),
    authSource: string(a.authSource),
    mechanism: checkMechanism(a.mechanism)
  }
  if (auth.type === 'scram' && !auth.username) fail('invalidConnection')
  if (
    auth.type === 'none' &&
    (auth.username ||
      auth.authSource ||
      (auth.mechanism && auth.mechanism !== 'DEFAULT') ||
      s.password)
  )
    fail('invalidConnection')
  const result: ConnectionInput = {
    id: '',
    name: string(s.name, '', 1024),
    host: string(s.host),
    port: port(s.port),
    useSrv: bool(s.useSrv),
    replicaSet: string(s.replicaSet),
    defaultDatabase: string(s.defaultDatabase),
    auth,
    ssh: ssh(s.ssh, warnings),
    tls: tls(s.tls, warnings),
    previewResources: s.previewResources === undefined ? undefined : bool(s.previewResources),
    cdnPrefix: string(s.cdnPrefix),
    options: options(s.options, warnings, preserveOptions)
  }
  if (s.color !== undefined && s.color !== '') {
    const color = string(s.color)
    if (/^#[0-9a-f]{6}$/i.test(color)) result.color = color
    else warn(warnings, 'unsupportedColor')
  }
  for (const field of SECRET_FIELDS)
    if (s[field] !== undefined) {
      // Passwords may contain newlines; they are never used in a URI unescaped.
      result[field] = secret(s[field])
    }
  validateHosts(result)
  if (!result.name) result.name = result.host
  if (hasFiles(result)) warn(warnings, 'externalFiles')
  return result
}
function hasFiles(i: ConnectionInput): boolean {
  return !!(
    i.tls.caFile ||
    i.tls.certificateKeyFile ||
    i.ssh.privateKeyPath ||
    i.ssh.jump?.privateKeyPath
  )
}

export function connectionTransferWarnings(
  input: ConnectionInput,
  format: TransferFormat
): string[] {
  const warnings: string[] = []
  const i = validateInput(input, warnings, format === 'amdm')
  if (format === 'robo3t' && i.options && Object.keys(i.options).length) {
    warnFields(warnings, 'roboOptionsUnsupported', Object.keys(i.options))
  }
  if (format !== 'amdm') {
    if (format === 'compass') {
      if (i.ssh.jump) warn(warnings, 'sshJumpOmitted')
      if (i.ssh.pinnedHostKey || i.ssh.jump?.pinnedHostKey) warn(warnings, 'sshHostKeyOmitted')
    } else {
      if (i.ssh.enabled) warn(warnings, 'sshOmitted')
      if (i.name) warn(warnings, 'nameOmitted')
      if (i.color) warn(warnings, 'colorOmitted')
    }
  }
  return warnings
}

export function mongoUriForTransfer(input: ConnectionInput, includeSecrets: boolean): string {
  const exportWarnings: string[] = []
  const i = validateInput(input, exportWarnings)
  if (exportHasLoss(exportWarnings))
    fail('unsupportedOptions')
  const extra: Record<string, string> = {}
  if (i.replicaSet && !i.useSrv) extra.replicaSet = i.replicaSet
  if (i.auth.type === 'scram') extra.authSource = i.auth.authSource || 'admin'
  if (i.tls.enabled) extra.tls = 'true'
  if (i.tls.allowInvalidCertificates) extra.tlsAllowInvalidCertificates = 'true'
  if (i.auth.mechanism && i.auth.mechanism !== 'DEFAULT') extra.authMechanism = i.auth.mechanism
  if (i.tls.caFile) extra.tlsCAFile = i.tls.caFile
  if (i.tls.certificateKeyFile) extra.tlsCertificateKeyFile = i.tls.certificateKeyFile
  // AMDM's single checkbox disables BOTH certificate and hostname validation.
  if (i.tls.allowInvalidCertificates) extra.tlsAllowInvalidHostnames = 'true'
  Object.assign(extra, i.options)
  let uri = buildMongoUri({
    useSrv: i.useSrv,
    host: i.host,
    port: i.port,
    defaultDatabase: i.defaultDatabase,
    authType: i.auth.type,
    username: i.auth.username,
    password: includeSecrets ? i.password : undefined,
    tlsEnabled: false,
    tlsAllowInvalid: false,
    options: extra
  })
  // buildMongoUri intentionally omits empty passwords; distinguish an explicit
  // empty password from an absent password in a transfer, including Compass.
  if (includeSecrets && i.password === '' && i.auth.type === 'scram' && i.auth.username)
    uri = uri.replace('@', ':@')
  return uri
}

function fromUri(value: unknown, warnings: string[]): ConnectionInput {
  if (typeof value !== 'string' || /[\x00-\x20\x7f#]/.test(value)) fail('invalidUri')
  try {
    const parsed = parseMongoUri(value)
    const query = new URLSearchParams(
      value.includes('?') ? value.slice(value.indexOf('?') + 1) : ''
    )
    const params = new Map<string, string>()
    const extra: Record<string, string> = Object.create(null)
    for (const [key, val] of query) {
      const k = key.toLowerCase()
      if (sensitiveKey.test(k)) fail('unsupportedOptions')
      if (params.has(k)) fail('unsupportedOptions')
      if (boolKeys.has(k) && !/^(true|false)$/i.test(val)) fail('unsupportedOptions')
      params.set(k, val)
      if (!mappedKeys.has(k)) extra[key] = val
    }
    const mechanism = checkMechanism(params.get('authmechanism') ?? undefined)
    if (mechanism && !parsed.hasAuth) fail('unsupportedAuthMechanism')
    const tlsValue = params.get('tls') ?? params.get('ssl')
    if (
      params.has('tls') &&
      params.has('ssl') &&
      params.get('tls')?.toLowerCase() !== params.get('ssl')?.toLowerCase()
    )
      fail('unsupportedTlsOptions')
    const insecure = params.get('tlsinsecure')?.toLowerCase() === 'true'
    const cert = params.get('tlsallowinvalidcertificates')?.toLowerCase() === 'true'
    const hostname = params.get('tlsallowinvalidhostnames')?.toLowerCase() === 'true'
    // Preserve separate flags in options: setting AMDM's combined checkbox
    // for a certificate-only flag would silently weaken hostname validation.
    if (params.has('tlsinsecure')) extra.tlsInsecure = params.get('tlsinsecure')!
    if (params.has('tlsallowinvalidcertificates'))
      extra.tlsAllowInvalidCertificates = params.get('tlsallowinvalidcertificates')!
    if (params.has('tlsallowinvalidhostnames'))
      extra.tlsAllowInvalidHostnames = params.get('tlsallowinvalidhostnames')!
    if (tlsValue?.toLowerCase() === 'false') extra.tls = 'false'
    const input: ConnectionInput = {
      id: '',
      name: parsed.hosts.join(','),
      host: parsed.hosts.join(','),
      useSrv: parsed.useSrv,
      replicaSet: params.get('replicaset') ?? '',
      defaultDatabase: parsed.defaultDatabase,
      auth: {
        type: parsed.hasAuth ? 'scram' : 'none',
        username: parsed.username,
        authSource:
          params.get('authsource') ?? (parsed.hasAuth ? parsed.defaultDatabase || 'admin' : ''),
        mechanism
      },
      ssh: { enabled: false },
      tls: {
        enabled: tlsValue === undefined ? parsed.useSrv : tlsValue.toLowerCase() === 'true',
        allowInvalidCertificates: insecure || (cert && hostname),
        caFile: params.get('tlscafile'),
        certificateKeyFile: params.get('tlscertificatekeyfile')
      },
      options: options(extra, warnings)
    }
    // Keep combined true flags in options, so explicit false flags are not lost.
    if (parsed.password !== null) input.password = parsed.password
    return validateInput(input, warnings)
  } catch (error) {
    return fail(safeCode(error, 'invalidUri'))
  }
}

function passphraseValue(passphrase?: string): string {
  if (!passphrase) fail('passwordRequired')
  if (typeof passphrase !== 'string' || Buffer.byteLength(passphrase) > 4096)
    fail('invalidEncryptionParameters')
  return passphrase
}
function base64(value: unknown, length?: number): Buffer {
  if (
    typeof value !== 'string' ||
    value.length % 4 !== 0 ||
    /[^A-Za-z0-9+/]/.test(value.replace(/={1,2}$/, ''))
  )
    fail('invalidEncryptionParameters')
  const result = Buffer.from(value, 'base64')
  if ((length !== undefined && result.length !== length) || result.toString('base64') !== value)
    fail('invalidEncryptionParameters')
  return result
}
async function amdmEncrypt(payload: Obj, passphrase: string): Promise<Obj> {
  const salt = randomBytes(16),
    iv = randomBytes(12)
  const key = await deriveScrypt(passphraseValue(passphrase), salt)
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv, {
      authTagLength: 16
    })
    cipher.setAAD(AAD)
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final()
    ])
    return {
      type: AMDM_TYPE,
      version: 1,
      encrypted: true,
      encryption: {
        cipher: 'aes-256-gcm',
        kdf: 'scrypt',
        N: SCRYPT.N,
        r: SCRYPT.r,
        p: SCRYPT.p,
        salt: salt.toString('base64'),
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64')
      },
      ciphertext: ciphertext.toString('base64')
    }
  } finally {
    key.fill(0)
  }
}
async function amdmDecrypt(envelope: Obj, passphrase?: string): Promise<Obj> {
  let e: Obj
  try {
    e = obj(envelope.encryption)
  } catch {
    return fail('invalidEncryptionParameters')
  }
  if (
    e.cipher !== 'aes-256-gcm' ||
    e.kdf !== 'scrypt' ||
    e.N !== SCRYPT.N ||
    e.r !== SCRYPT.r ||
    e.p !== SCRYPT.p
  )
    fail('invalidEncryptionParameters')
  const salt = base64(e.salt, 16),
    iv = base64(e.iv, 12),
    tag = base64(e.tag, 16),
    data = base64(envelope.ciphertext)
  if (!data.length || Object.hasOwn(envelope, 'connections')) fail('invalidFile')
  const key = await deriveScrypt(passphraseValue(passphrase), salt)
  let plaintext: string
  try {
    const cipher = createDecipheriv('aes-256-gcm', key, iv, {
      authTagLength: 16
    })
    cipher.setAAD(AAD)
    cipher.setAuthTag(tag)
    plaintext = Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8')
  } catch {
    return fail('invalidPassword')
  } finally {
    key.fill(0)
  }
  const payload = parseJson(plaintext)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('invalidFile')
  const p = payload as Obj
  if (p.type !== AMDM_TYPE || p.version !== 1) fail('invalidFile')
  return p
}

/** Key cache lives only for one encode/decode, never across user operations. */
class CompassCrypto {
  private keys = new Map<string, Buffer>()
  private exportSalt = randomBytes(16)
  constructor(private passphrase: string) {}
  private async key(salt: Buffer): Promise<Buffer> {
    const id = salt.toString('base64')
    let key = this.keys.get(id)
    if (!key) {
      // Compass exports share a salt. Bound adversarial files combining many
      // independent KDF jobs to 32 salts (each PBKDF2 has fixed work factors).
      if (this.keys.size >= 32) fail('invalidEncryptionParameters')
      key = await pbkdf2Async(passphraseValue(this.passphrase), salt, 100_000, 32, 'sha512')
      this.keys.set(id, key)
    }
    return key
  }
  async encrypt(secrets: Obj): Promise<string> {
    const key = await this.key(this.exportSalt),
      iv = randomBytes(16)
    const cipher = createCipheriv('aes-256-gcm', key, iv, {
      authTagLength: 16
    })
    const data = Buffer.concat([
      cipher.update(EJSON.stringify({ secrets }, { relaxed: false }), 'utf8'),
      cipher.final()
    ])
    return Buffer.concat([
      Buffer.from([0, 1]),
      this.exportSalt,
      iv,
      cipher.getAuthTag(),
      data
    ]).toString('base64')
  }
  async decrypt(value: unknown): Promise<Obj> {
    const b = base64(value)
    if (b.length <= 50 || b.readUInt16BE(0) !== 1) fail('invalidEncryptionParameters')
    const key = await this.key(b.subarray(2, 18))
    let text: string
    try {
      const cipher = createDecipheriv('aes-256-gcm', key, b.subarray(18, 34), {
        authTagLength: 16
      })
      cipher.setAuthTag(b.subarray(34, 50))
      text = Buffer.concat([cipher.update(b.subarray(50)), cipher.final()]).toString('utf8')
    } catch {
      return fail('invalidPassword')
    }
    try {
      return obj(obj(EJSON.parse(text)).secrets)
    } catch {
      return fail('invalidFile')
    }
  }
  dispose(): void {
    for (const key of this.keys.values()) key.fill(0)
    this.keys.clear()
  }
}

async function compassInput(
  value: unknown,
  warnings: string[],
  secrets?: Obj
): Promise<ConnectionInput> {
  const s = obj(EJSON.deserialize(obj(value))),
    c = obj(s.connectionOptions)
  unknownFields(
    s,
    ['id', 'lastUsed', 'favorite', 'savedConnectionType', 'connectionOptions', 'connectionSecrets'],
    warnings
  )
  unknownFields(c, ['connectionString', 'sshTunnel'], warnings)
  if (c.fleOptions || c.oidc || c.useApplicationLevelProxy) fail('unsupportedOptions')
  const input = fromUri(c.connectionString, warnings)
  if (s.favorite !== undefined) {
    const f = obj(s.favorite)
    input.name = string(f.name, input.name, 1024)
    input.color = f.color === undefined ? undefined : string(f.color)
    unknownFields(f, ['name', 'color'], warnings)
  }
  if (c.sshTunnel !== undefined) {
    const t = obj(c.sshTunnel)
    unknownFields(
      t,
      ['host', 'port', 'username', 'password', 'identityKeyFile', 'identityKeyPassphrase'],
      warnings
    )
    let file: unknown = t.identityKeyFile
    if (Array.isArray(file)) {
      if (file.length > 1) fail('unsupportedSshOptions')
      file = file[0]
    }
    input.ssh = {
      enabled: true,
      host: string(t.host),
      port: port(t.port),
      username: string(t.username),
      authMethod: file ? 'privateKey' : 'password',
      privateKeyPath: string(file)
    }
    if (t.password !== undefined) input.sshPassword = secret(t.password)
    if (t.identityKeyPassphrase !== undefined) input.sshPassphrase = secret(t.identityKeyPassphrase)
  }
  if (secrets) {
    if (
      Object.keys(secrets).some(
        (key) => !['password', 'sshTunnelPassword', 'sshTunnelPassphrase'].includes(key)
      )
    )
      fail('unsupportedOptions')
    if (secrets.password !== undefined) {
      if (typeof secrets.password !== 'string') fail('invalidConnection')
      try {
        input.password = decodeURIComponent(secrets.password)
      } catch {
        fail('invalidConnection')
      }
    }
    if (secrets.sshTunnelPassword !== undefined)
      input.sshPassword = secret(secrets.sshTunnelPassword)
    if (secrets.sshTunnelPassphrase !== undefined)
      input.sshPassphrase = secret(secrets.sshTunnelPassphrase)
  }
  return validateInput(input, warnings)
}

function roboInput(value: unknown, warnings: string[]): ConnectionInput {
  const s = obj(value)
  unknownFields(
    s,
    [
      'connectionName',
      'serverHost',
      'serverPort',
      'defaultDatabase',
      'isReplicaSet',
      'replicaSet',
      'credentials',
      'ssh',
      'ssl',
      'uuid'
    ],
    warnings
  )
  const input = emptyInput()
  input.name = string(s.connectionName, '', 1024)
  input.host = string(s.serverHost)
  input.port = port(s.serverPort)
  input.defaultDatabase = string(s.defaultDatabase)
  if (bool(s.isReplicaSet)) {
    const r = obj(s.replicaSet)
    const members: string[] = []
    for (let n = 0; Object.hasOwn(r, String(n)); n++) members.push(string(r[String(n)]))
    if (!members.length) fail('invalidConnection')
    input.host = members.join(',')
    delete input.port
    input.replicaSet = string(r.setNameUserEntered) || string(r.cachedSetName)
    const reads = ['primary', 'primaryPreferred', 'secondary', 'secondaryPreferred', 'nearest']
    if (r.readPreference !== undefined) {
      if (!Number.isInteger(r.readPreference) || !reads[r.readPreference as number])
        fail('unsupportedOptions')
      input.options = { readPreference: reads[r.readPreference as number] }
    }
    unknownFields(
      r,
      [
        'setNameUserEntered',
        'cachedSetName',
        'readPreference',
        ...members.map((_, n) => String(n))
      ],
      warnings
    )
  }
  if (s.credentials !== undefined) {
    if (!Array.isArray(s.credentials)) fail('invalidConnection')
    const credentials = s.credentials.map(obj)
    if (
      credentials.filter((c) => bool(c.enabled)).length > 1 ||
      credentials.slice(1).some((c) => bool(c.enabled))
    )
      fail('unsupportedMultipleCredentials')
    const c = credentials[0]
    if (c && bool(c.enabled)) {
      unknownFields(
        c,
        [
          'enabled',
          'userName',
          'userPassword',
          'userPasswordEncrypted',
          'databaseName',
          'mechanism',
          'useManuallyVisibleDbs',
          'manuallyVisibleDbs'
        ],
        warnings
      )
      input.auth = {
        type: 'scram',
        username: string(c.userName),
        authSource: string(c.databaseName),
        mechanism: checkMechanism(c.mechanism)
      }
      if (c.userPassword !== undefined) input.password = secret(c.userPassword)
      else if (c.userPasswordEncrypted) warn(warnings, 'encryptedSecretsOmitted')
      if (bool(c.useManuallyVisibleDbs)) warn(warnings, 'unsupportedDatabaseFilter')
    }
  }
  if (s.ssh !== undefined) {
    const t = obj(s.ssh)
    if (bool(t.enabled)) {
      unknownFields(
        t,
        [
          'enabled',
          'host',
          'port',
          'userName',
          'userPassword',
          'userPasswordEncrypted',
          'privateKeyFile',
          'publicKeyFile',
          'passphrase',
          'passphraseEncrypted',
          'method',
          'askPassword'
        ],
        warnings
      )
      if (t.method !== undefined && t.method !== 'publickey' && t.method !== 'password')
        fail('unsupportedSshOptions')
      input.ssh = {
        enabled: true,
        host: string(t.host),
        port: port(t.port),
        username: string(t.userName),
        authMethod: t.method === 'password' ? 'password' : 'privateKey',
        privateKeyPath: string(t.privateKeyFile)
      }
      if (t.userPassword !== undefined) input.sshPassword = secret(t.userPassword)
      else if (t.userPasswordEncrypted) warn(warnings, 'encryptedSecretsOmitted')
      if (t.passphrase !== undefined) input.sshPassphrase = secret(t.passphrase)
      else if (t.passphraseEncrypted) warn(warnings, 'encryptedSecretsOmitted')
    }
  }
  if (s.ssl !== undefined) {
    const t = obj(s.ssl)
    if (bool(t.sslEnabled)) {
      unknownFields(
        t,
        [
          'sslEnabled',
          'caFile',
          'usePemFile',
          'pemKeyFile',
          'pemPassPhrase',
          'pemPassPhraseEncrypted',
          'useAdvancedOptions',
          'crlFile',
          'allowInvalidHostnames',
          'allowInvalidCertificates',
          'askPassphrase'
        ],
        warnings
      )
      if (t.pemPassPhrase || t.pemPassPhraseEncrypted || t.crlFile || t.askPassphrase)
        fail('unsupportedTlsOptions')
      const cert = bool(t.allowInvalidCertificates),
        host = bool(t.allowInvalidHostnames)
      input.tls = {
        enabled: true,
        caFile: string(t.caFile),
        certificateKeyFile: bool(t.usePemFile) ? string(t.pemKeyFile) : '',
        allowInvalidCertificates: cert && host
      }
      input.options = {
        ...input.options,
        tlsAllowInvalidCertificates: String(cert),
        tlsAllowInvalidHostnames: String(host)
      }
    }
  }
  return validateInput(input, warnings)
}

export async function encodeConnections(
  inputs: ConnectionInput[],
  format: TransferFormat,
  includeSecrets: boolean,
  passphrase?: string
): Promise<string> {
  count(inputs)
  if (!['amdm', 'urls', 'compass', 'studio3t', 'nosqlbooster', 'robo3t'].includes(format))
    fail('unsupportedFormat')
  const clean = inputs.map((input) => {
    const warnings: string[] = []
    const validated = validateInput(input, warnings, format === 'amdm')
    if (exportHasLoss(warnings))
      fail('unsupportedOptions')
    return validated
  })
  if (format === 'amdm') {
    if (includeSecrets) passphraseValue(passphrase)
    const connections = clean.map((i) => {
      const { id: _, ...entry } = i
      if (!includeSecrets) for (const key of SECRET_FIELDS) delete entry[key]
      return entry
    })
    const payload = { type: AMDM_TYPE, version: 1, connections }
    return JSON.stringify(passphrase ? await amdmEncrypt(payload, passphrase) : payload, null, 2)
  }
  if (format !== 'compass')
    return clean.map((i) => mongoUriForTransfer(i, includeSecrets)).join('\n')
  const crypto = new CompassCrypto(passphrase ?? '')
  try {
    const connections: Obj[] = []
    for (const i of clean) {
      const encrypted = includeSecrets && !!passphrase
      const connectionOptions: Obj = {
        connectionString: mongoUriForTransfer(i, includeSecrets && !encrypted)
      }
      const secrets: Obj = {}
      if (encrypted && i.password !== undefined && i.auth.type === 'scram')
        secrets.password = encodeURIComponent(i.password)
      if (i.ssh.enabled) {
        connectionOptions.sshTunnel = {
          host: i.ssh.host,
          port: i.ssh.port ?? 22,
          username: i.ssh.username,
          ...(i.ssh.authMethod === 'privateKey' && i.ssh.privateKeyPath
            ? { identityKeyFile: [i.ssh.privateKeyPath] }
            : {}),
          ...(includeSecrets && !encrypted && i.sshPassword !== undefined
            ? { password: i.sshPassword }
            : {}),
          ...(includeSecrets && !encrypted && i.sshPassphrase !== undefined
            ? { identityKeyPassphrase: i.sshPassphrase }
            : {})
        }
        if (encrypted && i.sshPassword !== undefined) secrets.sshTunnelPassword = i.sshPassword
        if (encrypted && i.sshPassphrase !== undefined)
          secrets.sshTunnelPassphrase = i.sshPassphrase
      }
      const row: Obj = {
        id: randomUUID(),
        favorite: { name: i.name, ...(i.color ? { color: i.color } : {}) },
        savedConnectionType: 'favorite',
        connectionOptions
      }
      if (encrypted) row.connectionSecrets = await crypto.encrypt(secrets)
      connections.push(row)
    }
    return EJSON.stringify({ type: COMPASS_TYPE, version: 1, connections }, undefined, 2, {
      relaxed: false
    })
  } finally {
    crypto.dispose()
  }
}

export async function decodeConnections(
  text: string,
  passphrase?: string
): Promise<TransferRecord[]> {
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  if (!trimmed) fail('unsupportedFormat')
  let rows: unknown[], format: 'amdm' | 'compass' | 'robo3t' | 'urls'
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const value = parseJson(trimmed)
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('unsupportedFormat')
    let envelope = value as Obj
    if (envelope.type === AMDM_TYPE) {
      format = 'amdm'
      if (envelope.version !== 1) fail('unsupportedVersion')
      if (envelope.encrypted !== undefined && typeof envelope.encrypted !== 'boolean')
        fail('invalidFile')
      if (envelope.encrypted) envelope = await amdmDecrypt(envelope, passphrase)
      else if (envelope.encryption !== undefined || envelope.ciphertext !== undefined)
        fail('invalidFile')
    } else if (envelope.type === COMPASS_TYPE) {
      format = 'compass'
      const v = envelope.version
      if (
        v !== 1 &&
        !(
          v &&
          typeof v === 'object' &&
          !Array.isArray(v) &&
          Object.keys(v).length === 1 &&
          (v as Obj).$numberInt === '1'
        )
      )
        fail('unsupportedVersion')
    } else if (envelope.type === undefined && Array.isArray(envelope.connections)) {
      format = 'robo3t'
      // Do not misdetect arbitrary JSON/store files as native Robo3T.
      if (
        envelope.connections.length &&
        !envelope.connections.some(
          (r) => r && typeof r === 'object' && Object.hasOwn(r, 'serverHost')
        )
      )
        fail('unsupportedFormat')
    } else fail('unsupportedFormat')
    rows = count(envelope.connections)
    if (
      format === 'compass' &&
      rows.some((r) => r && typeof r === 'object' && (r as Obj).connectionSecrets)
    )
      passphraseValue(passphrase)
  } else {
    format = 'urls'
    rows = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('//'))
    count(rows)
    if (!rows.length || !rows.some((row) => /^mongodb(?:\+srv)?:\/\//.test(row as string)))
      fail('unsupportedFormat')
  }
  const crypto = new CompassCrypto(passphrase ?? '')
  try {
    // Authenticate every encrypted Compass entry before row validation. A bad
    // URI must not hide a wrong passphrase and permit a partial import.
    const secretsByRow = new Map<unknown, Obj>()
    if (format === 'compass') {
      for (const row of rows) {
        if (row && typeof row === 'object' && (row as Obj).connectionSecrets) {
          secretsByRow.set(row, await crypto.decrypt((row as Obj).connectionSecrets))
        }
      }
    }
    const result: TransferRecord[] = []
    for (const row of rows) {
      const warnings: string[] = []
      try {
        const input =
          format === 'amdm'
            ? validateInput(row, warnings, true)
            : format === 'compass'
              ? await compassInput(row, warnings, secretsByRow.get(row))
              : format === 'robo3t'
                ? roboInput(row, warnings)
                : fromUri(row, warnings)
        result.push({ input, warnings })
      } catch (error) {
        const code = safeCode(error)
        if (['passwordRequired', 'invalidPassword', 'invalidEncryptionParameters'].includes(code))
          fail(code)
        result.push({ input: emptyInput(), warnings, error: code })
      }
    }
    return result
  } finally {
    crypto.dispose()
  }
}
