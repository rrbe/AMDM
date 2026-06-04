/**
 * A stand-in for Electron's `app` + `safeStorage`, used by store unit tests so
 * they run in plain Node with no Electron runtime.
 *
 * Usage (the mock must be the SAME module instance the store imports, so state
 * set here is visible through `electron`):
 *
 *   vi.mock('electron', () => import('../../helpers/electron-mock'))
 *   import * as electron from '../../helpers/electron-mock'
 *   beforeEach(() => electron.freshUserDataDir())
 *
 * `safeStorage` is faked, not real crypto: encrypt prefixes "ENC:" and base64s,
 * decrypt reverses it. Toggle `safeStorage.available` to exercise the store's
 * dev fallback (the `plain:` path) when OS encryption is unavailable.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir = ''

/** Point `app.getPath('userData')` at a brand-new empty temp directory. */
export function freshUserDataDir(): string {
  userDataDir = mkdtempSync(join(tmpdir(), 'msg-store-'))
  return userDataDir
}

/** Pre-seed one of the store JSON files in the current userData dir. */
export function seedStoreFile(name: string, contents: unknown): void {
  writeFileSync(join(userDataDir, name), JSON.stringify(contents), 'utf8')
}

export const app = {
  getPath: (_name: string): string => userDataDir
}

export const safeStorage = {
  /** Flip to false to test the store's unavailable-encryption fallback. */
  available: true,
  isEncryptionAvailable(): boolean {
    return safeStorage.available
  },
  encryptString(value: string): Buffer {
    return Buffer.from(`ENC:${value}`, 'utf8')
  },
  decryptString(buf: Buffer): string {
    const s = buf.toString('utf8')
    if (!s.startsWith('ENC:')) throw new Error('electron-mock: bad ciphertext')
    return s.slice(4)
  }
}
