import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Toast } from '../../../src/renderer/src/components/common/Toast'

describe('Toast', () => {
  it('renders details, repeat counts and the appropriate live-region role', () => {
    const warning = renderToStaticMarkup(
      createElement(Toast, {
        variant: 'warn',
        title: 'Query warning',
        detail: 'operation exceeded time limit',
        repeatCount: 2,
        autoDismissMs: 8_000,
        onDismiss: vi.fn()
      })
    )
    const error = renderToStaticMarkup(
      createElement(Toast, {
        variant: 'error',
        title: 'Query failed',
        autoDismissMs: null,
        onDismiss: vi.fn()
      })
    )

    expect(warning).toContain('role="status"')
    expect(warning).toContain('Query warning')
    expect(warning).toContain('operation exceeded time limit')
    expect(warning).toContain('×2')
    expect(error).toContain('role="alert"')
  })
})
