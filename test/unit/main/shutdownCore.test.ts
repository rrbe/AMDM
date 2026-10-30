import { describe, expect, it, vi } from 'vitest'
import { ShutdownController } from '../../../src/main/shutdownCore'

describe('application shutdown', () => {
  it('preserves the workspace and all resources when confirmation is cancelled', async () => {
    const cleanup = vi.fn()
    const controller = new ShutdownController({
      needsConfirmation: () => true,
      confirm: async () => false,
      cleanup
    })
    expect(await controller.prepare()).toBe(false)
    expect(cleanup).not.toHaveBeenCalled()
    expect(controller.ready).toBe(false)
  })

  it('coalesces close/quit requests and waits for cleanup before allowing exit', async () => {
    let finish!: () => void
    const confirm = vi.fn(async () => true)
    const cleanup = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const controller = new ShutdownController({ needsConfirmation: () => true, confirm, cleanup })
    const first = controller.prepare()
    expect(controller.prepare()).toBe(first)
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce())
    expect(controller.ready).toBe(false)
    finish()
    expect(await first).toBe(true)
    expect(controller.ready).toBe(true)
    expect(await controller.prepare()).toBe(true)
    expect(confirm).toHaveBeenCalledOnce()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('cleans an empty workspace without prompting', async () => {
    const confirm = vi.fn()
    const cleanup = vi.fn(async () => {})
    const controller = new ShutdownController({ needsConfirmation: () => false, confirm, cleanup })
    expect(await controller.prepare()).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('allows another close attempt after cancellation or failed cleanup', async () => {
    const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    const cleanup = vi
      .fn()
      .mockRejectedValueOnce(new Error('cleanup failed'))
      .mockResolvedValue(undefined)
    const controller = new ShutdownController({ needsConfirmation: () => true, confirm, cleanup })
    expect(await controller.prepare()).toBe(false)
    await expect(controller.prepare()).rejects.toThrow('cleanup failed')
    expect(controller.ready).toBe(false)
    expect(await controller.prepare()).toBe(true)
  })
})
