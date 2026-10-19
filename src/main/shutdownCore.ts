interface ShutdownActions {
  needsConfirmation(): boolean
  confirm(): Promise<boolean>
  cleanup(): Promise<void>
}

/** Keep windows alive until confirmation and asynchronous resource cleanup finish. */
export class ShutdownController {
  ready = false
  private pending?: Promise<boolean>

  constructor(private readonly actions: ShutdownActions) {}

  prepare(): Promise<boolean> {
    if (this.ready) return Promise.resolve(true)
    if (this.pending) return this.pending
    this.pending = Promise.resolve()
      .then(async () => {
        if (this.actions.needsConfirmation() && !(await this.actions.confirm())) return false
        await this.actions.cleanup()
        this.ready = true
        return true
      })
      .finally(() => {
        this.pending = undefined
      })
    return this.pending
  }
}
