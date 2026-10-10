import { createHash } from 'node:crypto'
import type { AuthorizationResult, ConnectionAuthorization } from '../../shared/types'
import { buildClientArgs, type DecryptedConnection } from './uri'

const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_ENTRIES = 64

/** Config identity stays in main; cache keys never retain plaintext secrets. */
export function authorizationCacheKey(dec: DecryptedConnection): string {
  const value = {
    mongo: buildClientArgs(dec),
    ssh: dec.config.ssh.enabled
      ? {
          config: {
            ...dec.config.ssh,
            port: dec.config.ssh.port ?? 22,
            authMethod: dec.config.ssh.authMethod ?? 'password',
            // Learned trust pins do not change the destination or authenticated account.
            pinnedHostKey: undefined,
            jump: dec.config.ssh.jump
              ? {
                  ...dec.config.ssh.jump,
                  port: dec.config.ssh.jump.port ?? 22,
                  authMethod: 'privateKey',
                  pinnedHostKey: undefined
                }
              : undefined
          },
          password: dec.sshPassword,
          passphrase: dec.sshPassphrase,
          jumpPassphrase: dec.jumpSshPassphrase
        }
      : undefined
  }
  const json = JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item
  )
  return createHash('sha256').update(json).digest('hex')
}

export class AuthorizationCache {
  private entries = new Map<string, { authorization: ConnectionAuthorization; expiresAt: number }>()

  get(key: string, now = Date.now()): AuthorizationResult | null {
    const entry = this.entries.get(key)
    if (!entry) return null
    if (entry.expiresAt <= now) {
      this.entries.delete(key)
      return null
    }
    return { authorization: entry.authorization }
  }

  set(key: string, result: AuthorizationResult, now = Date.now()): void {
    this.entries.delete(key)
    for (const [entryKey, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(entryKey)
    }
    if (!result.authorization) return
    this.entries.set(key, { authorization: result.authorization, expiresAt: now + CACHE_TTL_MS })
    if (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!)
  }

  clear(): void {
    this.entries.clear()
  }
}
