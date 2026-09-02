import { type Disposer, PluginEventBus, type PluginHost } from '@brimveyn/aimux-plugin'

import type { PluginRecord, PluginRpcTransport, PluginStatus } from '../types'

import { logDebug } from '../../debug/input-log'
import { appendPluginLog } from '../log'
import { isReservedRpcVerb } from '../rpc-envelope'
import { PluginFiber } from './fiber'
import { ServiceRegistry } from './service-registry'

/**
 * One kernel per host process. It owns the event bus, the service registry and
 * the fibers, and it is the only thing that decides when a plugin loads,
 * unloads, or reloads.
 *
 * What it deliberately does *not* know: how to reach the other half (that is
 * the injected transport), where records come from (the loader), or when a
 * file changed (the watcher). Keeping those out is what lets the same kernel
 * run in the UI and in the daemon unchanged.
 */

/** A handler that hangs would otherwise hang the caller's socket forever. */
const RPC_HANDLER_TIMEOUT_MS = 10_000

export interface PluginKernelOptions {
  host: PluginHost
  transport: PluginRpcTransport
  /** Fired after any fiber changes state — the UI re-renders on it. */
  onStatusChange?: (statuses: PluginStatus[]) => void
}

export class PluginKernel {
  readonly bus: PluginEventBus
  readonly services = new ServiceRegistry()
  readonly host: PluginHost

  private readonly fibers = new Map<string, PluginFiber>()
  private readonly rpcHandlers = new Map<string, Map<string, (payload: unknown) => unknown>>()
  private readonly transport: PluginRpcTransport
  private readonly onStatusChange: ((statuses: PluginStatus[]) => void) | undefined
  private disposed = false

  constructor(options: PluginKernelOptions) {
    this.host = options.host
    this.transport = options.transport
    this.onStatusChange = options.onStatusChange
    this.bus = new PluginEventBus({
      onError: (error, context) => {
        const owner = context.owner ?? 'unknown'
        appendPluginLog(owner, {
          at: new Date().toISOString(),
          data: { error: String(error), event: context.event },
          host: this.host,
          level: 'error',
          message: 'event listener failed',
        })
      },
    })

    // A withdrawn service invalidates whoever injected it, and a new one may
    // unblock a pending fiber. Both are handled in one place so the rules
    // cannot drift apart.
    this.services.onChange((name, present) => {
      void this.reactToServiceChange(name, present)
    })
  }

  private async reactToServiceChange(name: string, present: boolean): Promise<void> {
    if (this.disposed) return
    const fibers = [...this.fibers.values()]
    for (const fiber of fibers) {
      if (present) {
        if (fiber.state === 'pending' && fiber.record.enabled) await fiber.start()
        continue
      }
      // Withdrawn: anything that injected it is now holding a reference to a
      // disposed plugin. Unload rather than let it run half-wired.
      if (fiber.state === 'active' && fiber.missingServices.includes(name)) {
        logDebug('plugin.kernel.unloadOnServiceLoss', { pluginId: fiber.id, service: name })
        await fiber.dispose()
      }
    }
  }

  private notify(): void {
    this.onStatusChange?.(this.statuses())
  }

  private registerRpcHandler(
    pluginId: string,
    verb: string,
    handler: (payload: unknown) => unknown
  ): Disposer {
    if (isReservedRpcVerb(verb)) {
      throw new Error(`rpc verb "${verb}" is reserved: verbs starting with "__" belong to aimux`)
    }
    let byVerb = this.rpcHandlers.get(pluginId)
    if (!byVerb) {
      byVerb = new Map()
      this.rpcHandlers.set(pluginId, byVerb)
    }
    byVerb.set(verb, handler)
    return () => {
      const current = this.rpcHandlers.get(pluginId)
      if (current?.get(verb) !== handler) return
      current.delete(verb)
      if (current.size === 0) this.rpcHandlers.delete(pluginId)
    }
  }

  private fiberHost(): ConstructorParameters<typeof PluginFiber>[3] {
    return {
      bus: this.bus,
      onStateChange: () => {
        this.notify()
      },
      registerRpcHandler: (pluginId, verb, handler) =>
        this.registerRpcHandler(pluginId, verb, handler),
      services: this.services,
      transport: this.transport,
    }
  }

  /** The half of `record` this kernel runs, if the manifest declares one. */
  private entryFor(record: PluginRecord): string | undefined {
    return record.manifest.entries?.[this.host]
  }

  /**
   * Reconciles the live fibers against a fresh set of records: loads what is
   * new or newly enabled, unloads what disappeared or was disabled, and
   * reloads what moved on disk. The loader calls this on boot and after every
   * registry change, so there is a single code path for "make reality match
   * the records".
   */
  async apply(records: readonly PluginRecord[]): Promise<void> {
    if (this.disposed) return
    const wanted = new Map<string, PluginRecord>()
    for (const record of records) {
      if (this.entryFor(record) === undefined) continue
      wanted.set(record.id, record)
    }

    const live = [...this.fibers]
    for (const [id, fiber] of live) {
      const record = wanted.get(id)
      if (!record || !record.enabled) {
        await fiber.dispose()
        this.fibers.delete(id)
        this.rpcHandlers.delete(id)
      } else if (record.root !== fiber.record.root) {
        // Relinked elsewhere: the old fiber's entry path is stale.
        await fiber.dispose()
        this.fibers.delete(id)
        this.rpcHandlers.delete(id)
      }
    }

    for (const [id, record] of wanted) {
      if (!record.enabled) continue
      if (this.fibers.has(id)) continue
      const entry = this.entryFor(record)
      if (entry === undefined) continue
      const fiber = new PluginFiber(record, this.host, entry, this.fiberHost())
      this.fibers.set(id, fiber)
      await fiber.start()
    }

    this.notify()
  }

  /** Hot reload of one plugin, or of every loaded plugin when `id` is absent. */
  async reload(id?: string): Promise<void> {
    if (this.disposed) return
    const all = [...this.fibers.values()]
    const targets = id === undefined ? all : all.filter((fiber) => fiber.id === id)
    for (const fiber of targets) await fiber.reload()
    this.notify()
  }

  async unload(id: string): Promise<void> {
    const fiber = this.fibers.get(id)
    if (!fiber) return
    await fiber.dispose()
    this.fibers.delete(id)
    this.rpcHandlers.delete(id)
    this.notify()
  }

  has(id: string): boolean {
    return this.fibers.has(id)
  }

  statuses(): PluginStatus[] {
    return [...this.fibers.values()].map((fiber) => fiber.status())
  }

  /**
   * Dispatches an incoming RPC to the plugin's handler. Called by whichever
   * host owns the socket; the payload has been validated as an envelope and
   * never inspected further.
   *
   * The timeout is the reason the risk of "a plugin blocks the daemon" is
   * bounded: a handler that never settles rejects the caller instead of
   * pinning its socket.
   */
  async handleRpc(pluginId: string, verb: string, payload: unknown): Promise<unknown> {
    const handler = this.rpcHandlers.get(pluginId)?.get(verb)
    if (!handler) {
      throw new Error(`no ${this.host} handler for plugin rpc verb: ${pluginId}.${verb}`)
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        Promise.resolve(handler(payload)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(
              new Error(
                `plugin rpc handler timed out after ${RPC_HANDLER_TIMEOUT_MS}ms: ${pluginId}.${verb}`
              )
            )
          }, RPC_HANDLER_TIMEOUT_MS)
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  /** Delivers a one-way message from the other half onto the local bus. */
  deliverBroadcast(pluginId: string, verb: string, payload: unknown): void {
    this.bus.emit(`rpc:${pluginId}.${verb}`, payload)
    const handler = this.rpcHandlers.get(pluginId)?.get(verb)
    if (!handler) return
    void this.dispatchBroadcast(pluginId, verb, payload)
  }

  /** A broadcast has no caller to reject; a failure goes to the plugin's log. */
  private async dispatchBroadcast(pluginId: string, verb: string, payload: unknown): Promise<void> {
    try {
      await this.handleRpc(pluginId, verb, payload)
    } catch (error) {
      appendPluginLog(pluginId, {
        at: new Date().toISOString(),
        data: { error: String(error), verb },
        host: this.host,
        level: 'error',
        message: 'broadcast handler failed',
      })
    }
  }

  /** Host-side event emission — how `tab:turnComplete` and friends reach plugins. */
  emit(event: string, payload?: unknown): void {
    this.bus.emit(event, payload)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const fiber of this.fibers.values()) await fiber.dispose()
    this.fibers.clear()
    this.rpcHandlers.clear()
    this.bus.clear()
  }
}
