import { describe, expect, it } from 'vitest'
import { bringWindowToFront } from '../../../src/main/windowOpenCore'

describe('bringWindowToFront', () => {
  it('restores minimized windows before showing and focusing them', () => {
    const calls: string[] = []
    bringWindowToFront({
      isMinimized: () => true,
      restore: () => calls.push('restore'),
      show: () => calls.push('show'),
      moveTop: () => calls.push('moveTop'),
      focus: () => calls.push('focus')
    })

    expect(calls).toEqual(['restore', 'show', 'moveTop', 'focus'])
  })
})
