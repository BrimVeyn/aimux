import type { Disposer } from './types'

/**
 * The disposer stack behind `ctx.effect` and every `register()` that hands one
 * back. Unwinds in reverse registration order — the same discipline as a
 * destructor chain — so a later effect can rely on an earlier one still being
 * live while it tears itself down.
 *
 * A throwing disposer never stops the unwind: the remaining effects still run
 * and the errors are reported together. A half-disposed fiber is the one state
 * hot reload cannot recover from.
 */
export class EffectStack {
  private disposers: Disposer[] = []
  private disposed = false

  get size(): number {
    return this.disposers.length
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  /**
   * Registers a disposer. Adding one to an already-disposed stack runs it
   * immediately rather than leaking it — that happens when an async `apply`
   * resolves after the fiber was torn down.
   */
  add(disposer: Disposer): void {
    if (this.disposed) {
      void this.disposeOrphan(disposer)
      return
    }
    this.disposers.push(disposer)
  }

  private async disposeOrphan(disposer: Disposer): Promise<void> {
    try {
      await disposer()
    } catch {
      // Nothing left to report to: the stack this belonged to is gone.
    }
  }

  /** Runs `setup` now and registers whatever disposer it returns. */
  async run(setup: () => Disposer | void | Promise<Disposer | void>): Promise<void> {
    const disposer = await setup()
    if (typeof disposer === 'function') this.add(disposer)
  }

  /** Unwind. Returns every error thrown, in the order they were thrown. */
  async dispose(): Promise<unknown[]> {
    this.disposed = true
    const pending = this.disposers
    this.disposers = []
    const errors: unknown[] = []
    for (let i = pending.length - 1; i >= 0; i--) {
      try {
        await pending[i]?.()
      } catch (error) {
        errors.push(error)
      }
    }
    return errors
  }
}
