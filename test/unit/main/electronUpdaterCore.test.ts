import { describe, expect, it } from 'vitest'
import type { UpdateState } from '../../../src/shared/types'
import {
  canUseElectronUpdater,
  nextElectronUpdateState
} from '../../../src/main/electronUpdaterCore'

const idle: UpdateState = {
  available: true,
  automaticallyChecksForUpdates: true,
  phase: 'idle',
  availableVersion: null,
  downloadProgress: null
}

describe('electron updater core', () => {
  it('only enables packaged NSIS and AppImage builds', () => {
    expect(canUseElectronUpdater(false, 'win32', undefined)).toBe(false)
    expect(canUseElectronUpdater(true, 'win32', undefined)).toBe(true)
    expect(canUseElectronUpdater(true, 'linux', '/tmp/AMDM.AppImage')).toBe(true)
    expect(canUseElectronUpdater(true, 'linux', undefined)).toBe(false)
    expect(canUseElectronUpdater(true, 'darwin', undefined)).toBe(false)
  })

  it('tracks availability, bounded progress, completion, and retry state', () => {
    const available = nextElectronUpdateState(idle, { type: 'available', version: '26.9.18' })
    expect(available).toMatchObject({ phase: 'available', availableVersion: '26.9.18' })

    const downloading = nextElectronUpdateState(available, {
      type: 'progress',
      progress: { percent: 101, transferred: 80, total: 100, bytesPerSecond: 20, delta: 10 }
    })
    expect(downloading.downloadProgress?.percent).toBe(100)
    expect(nextElectronUpdateState(downloading, { type: 'failed' })).toMatchObject({
      phase: 'available',
      downloadProgress: null
    })
    expect(nextElectronUpdateState(downloading, { type: 'downloaded', version: '26.9.18' })).toMatchObject({
      phase: 'downloaded',
      availableVersion: '26.9.18',
      downloadProgress: null
    })
  })
})
