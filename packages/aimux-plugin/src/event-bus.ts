import type { Disposer, PluginEventListener } from './types'

/**
 * The event bus lives in the public package rather than in the host so that
 * `createTestContext()` dispatches exactly the way the kernel does. A plugin
 * test that passes against the harness is testing the real semantics of
 * `bail` and `waterfall`, not an approximation of them.
 *
 * It has no aimux dependencies — it is a listener map and five dispatch
 * strategies.
 */

interface Registration {
  listener: PluginEventListener<never>
  /** Only used for error attribution; the bus itself is owner-agnostic. */
  owner?: string
}

export interface EventBusOptions {
  /**
   * Called when a listener throws or rejects. `emit` has nowhere to put the
   * error otherwise, and swallowing it silently is how a plugin bug becomes
   * a mystery. The awaiting modes rethrow instead.
   */
  onError?: (error: unknown, context: { event: string; owner?: string }) => void
}

export class PluginEventBus {
  private readonly listeners = new Map<string, Registration[]>()

  constructor(private readonly options: EventBusOptions = {}) {}

  on<T = unknown>(event: string, listener: PluginEventListener<T>, owner?: string): Disposer {
    const registration: Registration = { listener: listener as PluginEventListener<never>, owner }
    const existing = this.listeners.get(event)
    if (existing) existing.push(registration)
    else this.listeners.set(event, [registration])

    return () => {
      const current = this.listeners.get(event)
      if (!current) return
      const index = current.indexOf(registration)
      if (index !== -1) current.splice(index, 1)
      if (current.length === 0) this.listeners.delete(event)
    }
  }

  /** Snapshot: a listener that unsubscribes mid-dispatch must not shift the list. */
  private snapshot(event: string): Registration[] {
    const current = this.listeners.get(event)
    return current ? [...current] : []
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.length ?? 0
  }

  /** Every event that currently has at least one listener. */
  events(): string[] {
    return [...this.listeners.keys()]
  }

  private report(error: unknown, event: string, owner?: string): void {
    this.options.onError?.(error, { event, owner })
  }

  private async reportRejection(
    result: Promise<unknown>,
    event: string,
    owner?: string
  ): Promise<void> {
    try {
      await result
    } catch (error) {
      this.report(error, event, owner)
    }
  }

  /**
   * Synchronous listeners run synchronously — `emit` then asserting on the
   * effect must not need an intervening await. Only an async listener's
   * rejection is picked up later.
   */
  emit(event: string, payload?: unknown): void {
    for (const { listener, owner } of this.snapshot(event)) {
      let result: unknown
      try {
        result = listener(payload as never)
      } catch (error) {
        this.report(error, event, owner)
        continue
      }
      if (result instanceof Promise) void this.reportRejection(result, event, owner)
    }
  }

  async parallel(event: string, payload?: unknown): Promise<unknown[]> {
    return Promise.all(this.snapshot(event).map(({ listener }) => listener(payload as never)))
  }

  async serial(event: string, payload?: unknown): Promise<unknown[]> {
    const results: unknown[] = []
    for (const { listener } of this.snapshot(event)) {
      results.push(await listener(payload as never))
    }
    return results
  }

  /** First listener to return anything but `undefined` wins; the rest never run. */
  async bail<T>(event: string, payload?: unknown): Promise<T | undefined> {
    for (const { listener } of this.snapshot(event)) {
      const result = await listener(payload as never)
      if (result !== undefined) return result as T
    }
    return undefined
  }

  /**
   * Threads a value through the chain. A listener returning `undefined` is
   * read as "no opinion" and leaves the value untouched, so a listener that
   * only inspects the value does not have to remember to return it.
   */
  async waterfall<T>(event: string, value: T): Promise<T> {
    let current = value
    for (const { listener } of this.snapshot(event)) {
      const next = await listener(current as never)
      if (next !== undefined) current = next as T
    }
    return current
  }

  /** Drop every listener. Used when a whole kernel is torn down. */
  clear(): void {
    this.listeners.clear()
  }
}
