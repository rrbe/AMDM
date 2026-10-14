import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { UpdateAvailableDot } from '../../../src/renderer/src/components/settings/SettingsWindow'

describe('settings update indicator', () => {
  it('renders an accessible red status dot for an available version', () => {
    const markup = renderToStaticMarkup(createElement(UpdateAvailableDot, { version: '26.8.16' }))

    expect(markup).toContain('role="status"')
    expect(markup).toContain('26.8.16')
    expect(markup).toContain('bg-destructive')
  })
})
