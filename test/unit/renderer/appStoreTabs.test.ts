import { beforeEach, describe, expect, it } from 'vitest'
import { createTab } from '../../../src/renderer/src/lib/tabs'
import { useAppStore } from '../../../src/renderer/src/store/useAppStore'

describe('connection-bound tabs', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [createTab('c1-tab', { connectionId: 'c1' })],
      activeTabId: 'c1-tab',
      activeConnectionId: 'c1'
    })
  })

  it('switches or creates tabs with their bound connection', () => {
    useAppStore.getState().setActiveConnection('c2')
    const c2Tab = useAppStore.getState().tabs.find((tab) => tab.connectionId === 'c2')

    expect(c2Tab).toBeDefined()
    expect(useAppStore.getState().activeTabId).toBe(c2Tab?.id)

    useAppStore.getState().setActiveTab('c1-tab')
    expect(useAppStore.getState().activeConnectionId).toBe('c1')

    useAppStore.getState().setActiveConnection('c2')
    expect(useAppStore.getState().tabs).toHaveLength(2)
    expect(useAppStore.getState().activeTabId).toBe(c2Tab?.id)
  })
})
