import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { ConnectionConfig, ConnectionInput } from '../../shared/types'

interface StoredSecrets {
  encPassword?: string
  encSshPassword?: string
  encSshPassphrase?: string
  encJumpSshPassphrase?: string
}

type StoredConnection = Omit<
  ConnectionConfig,
  'hasPassword' | 'hasSshPassword' | 'hasSshPassphrase' | 'hasJumpSshPassphrase'
> &
  StoredSecrets

interface StoreFile {
  version: 1
  connections: StoredConnection[]
}

const PLAIN_PREFIX = 'plain:' // dev fallback marker when OS encryption is unavailable

/**
 * Persists connections to a JSON file in userData.
 * Secrets are encrypted with Electron `safeStorage` (macOS Keychain-backed) and
 * never leave the main process in plaintext except when the user enters them.
 */
class ConnectionStore {
  private filePath = ''
  private data: StoreFile = { version: 1, connections: [] }

  init(): void {
    this.filePath = join(app.getPath('userData'), 'connections.json')
    if (existsSync(this.filePath)) {
      try {
        const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<StoreFile>
        // Normalize: drops any legacy `groups` field from older versions.
        this.data = { version: 1, connections: parsed.connections ?? [] }
      } catch {
        this.data = { version: 1, connections: [] }
      }
    }
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8')
  }

  private encrypt(value: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(value).toString('base64')
    }
    // Dev fallback: not secure. Real macOS runs always have Keychain available.
    console.warn('[connectionStore] safeStorage unavailable — storing secret base64-only (dev)')
    return PLAIN_PREFIX + Buffer.from(value, 'utf8').toString('base64')
  }

  private decrypt(enc?: string): string | undefined {
    if (!enc) return undefined
    if (enc.startsWith(PLAIN_PREFIX)) {
      return Buffer.from(enc.slice(PLAIN_PREFIX.length), 'base64').toString('utf8')
    }
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return undefined
    }
  }

  /** Decide the new encrypted value given the incoming plaintext field. */
  private nextSecret(existing: string | undefined, incoming: string | undefined): string | undefined {
    if (incoming === undefined) return existing // unchanged
    if (incoming === '') return undefined // cleared
    return this.encrypt(incoming)
  }

  private sanitize(c: StoredConnection): ConnectionConfig {
    const { encPassword, encSshPassword, encSshPassphrase, encJumpSshPassphrase, ...rest } = c
    return {
      ...rest,
      hasPassword: !!encPassword,
      hasSshPassword: !!encSshPassword,
      hasSshPassphrase: !!encSshPassphrase,
      hasJumpSshPassphrase: !!encJumpSshPassphrase
    }
  }

  // --- connections ---
  listConnections(): ConnectionConfig[] {
    return this.data.connections.map((c) => this.sanitize(c))
  }

  saveConnection(input: ConnectionInput): ConnectionConfig {
    const now = Date.now()
    const id = input.id || randomUUID()
    const existing = this.data.connections.find((c) => c.id === id)

    const stored: StoredConnection = {
      id,
      name: input.name,
      color: input.color,
      useSrv: input.useSrv,
      host: input.host,
      port: input.port,
      replicaSet: input.replicaSet,
      defaultDatabase: input.defaultDatabase,
      options: input.options,
      auth: input.auth,
      ssh: input.ssh,
      tls: input.tls,
      encPassword: this.nextSecret(existing?.encPassword, input.password),
      encSshPassword: this.nextSecret(existing?.encSshPassword, input.sshPassword),
      encSshPassphrase: this.nextSecret(existing?.encSshPassphrase, input.sshPassphrase),
      encJumpSshPassphrase: this.nextSecret(existing?.encJumpSshPassphrase, input.jumpSshPassphrase),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }

    const idx = this.data.connections.findIndex((c) => c.id === id)
    if (idx >= 0) this.data.connections[idx] = stored
    else this.data.connections.push(stored)
    this.persist()
    return this.sanitize(stored)
  }

  deleteConnection(id: string): void {
    this.data.connections = this.data.connections.filter((c) => c.id !== id)
    this.persist()
  }

  /**
   * Pin the SSH host-key fingerprint learned on first connect (TOFU). No-op if
   * the connection is gone or already pinned to the same value. The fingerprint
   * is not a secret, so it lives in plaintext alongside the rest of the config.
   */
  recordSshHostKey(id: string, fingerprint: string): void {
    const stored = this.data.connections.find((c) => c.id === id)
    if (!stored || stored.ssh.pinnedHostKey === fingerprint) return
    stored.ssh = { ...stored.ssh, pinnedHostKey: fingerprint }
    this.persist()
  }

  /** Pin the jump (bastion) host-key fingerprint learned on first connect (TOFU). */
  recordSshJumpHostKey(id: string, fingerprint: string): void {
    const stored = this.data.connections.find((c) => c.id === id)
    if (!stored || !stored.ssh.jump || stored.ssh.jump.pinnedHostKey === fingerprint) return
    stored.ssh = { ...stored.ssh, jump: { ...stored.ssh.jump, pinnedHostKey: fingerprint } }
    this.persist()
  }

  /** Internal-only: decrypted secrets for use at connect time. Never sent over IPC. */
  getDecrypted(id: string): {
    config: ConnectionConfig
    password?: string
    sshPassword?: string
    sshPassphrase?: string
    jumpSshPassphrase?: string
  } | null {
    const stored = this.data.connections.find((c) => c.id === id)
    if (!stored) return null
    return {
      config: this.sanitize(stored),
      password: this.decrypt(stored.encPassword),
      sshPassword: this.decrypt(stored.encSshPassword),
      sshPassphrase: this.decrypt(stored.encSshPassphrase),
      jumpSshPassphrase: this.decrypt(stored.encJumpSshPassphrase)
    }
  }
}

export const connectionStore = new ConnectionStore()
