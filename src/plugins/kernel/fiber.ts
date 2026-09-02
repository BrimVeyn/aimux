import {
  type Disposer,
  EffectStack,
  type PluginContext,
  type PluginDefinition,
  type PluginEventBus,
  type PluginEventListener,
  type PluginHost,
} from '@brimveyn/aimux-plugin'
import { resolve } from 'node:path'

import type { PluginRecord, PluginRpcTransport, PluginStatus } from '../types'
import type { ServiceRegistry } from './service-registry'

import { logDebug } from '../../debug/input-log'
import { createPluginLogger } from '../log'
import { loadPluginEntry } from '../module-loader'
import { ensurePluginDirs } from '../paths'

/**
 * One half of one plugin, and the unit the state machine acts on:
 *
 *   PENDING ──(deps satisfied)──▶ LOADING ──▶ ACTIVE
 *      ▲                              │           │
 *      └──(dep withdrawn)─────────────┘       (apply threw)
 *                                                 ▼
 *   UNLOADING ──▶ DISPOSED                     FAILED
 *
 * The fiber owns an `EffectStack`, and every context API it hands the plugin
 * pushes onto that stack. Unloading is therefore total by construction: there
 * is no registration path that bypasses it.
 */

/** What a fiber needs from the kernel, narrowed so the two don't import each other. */
export interface FiberHost {
  bus: PluginEventBus
  services: ServiceRegistry
  transport: PluginRpcTransport
  registerRpcHandler: (
    pluginId: string,
    verb: string,
    handler: (payload: unknown) => unknown
  ) => Disposer
  /** Called on every state transition so the kernel can re-evaluate and notify. */
  onStateChange: (fiber: PluginFiber) => void
}

export type FiberState = PluginStatus['state']

/**
 * `ctx.effect` cannot await — it is called from a synchronous `apply` body —
 * so a setup that rejects has nowhere to surface but the plugin's own log.
 */
async function runEffect(
  stack: EffectStack,
  setup: Parameters<EffectStack['run']>[0],
  log: PluginContext['log']
): Promise<void> {
  try {
    await stack.run(setup)
  } catch (error) {
    log.error('effect setup failed', { error: String(error) })
  }
}

export class PluginFiber {
  private stack = new EffectStack()
  private currentState: FiberState = 'pending'
  private failure: Error | null = null
  private loadRevision = 0
  private startPromise: Promise<void> | null = null

  constructor(
    readonly record: PluginRecord,
    readonly host: PluginHost,
    /** Entry file, relative to the plugin root, for this half. */
    private readonly entry: string,
    private readonly kernel: FiberHost
  ) {}

  get id(): string {
    return this.record.id
  }

  get state(): FiberState {
    return this.currentState
  }

  get error(): Error | null {
    return this.failure
  }

  get revision(): number {
    return this.loadRevision
  }

  get effectCount(): number {
    return this.stack.size
  }

  /** Services listed in `inject` that are not yet provided. */
  private injected: readonly string[] = []

  get missingServices(): string[] {
    return this.kernel.services.missing(this.injected)
  }

  status(): PluginStatus {
    const missing = this.currentState === 'pending' ? this.missingServices : []
    return {
      effects: this.stack.size,
      enabled: this.record.enabled,
      host: this.host,
      id: this.record.id,
      name: this.record.manifest.name ?? this.record.id,
      revision: this.loadRevision,
      root: this.record.root,
      source: this.record.source,
      state: this.currentState,
      version: this.record.manifest.version,
      ...(this.failure ? { error: this.failure.message } : {}),
      ...(missing.length > 0 ? { missing } : {}),
    }
  }

  private transition(next: FiberState): void {
    if (this.currentState === next) return
    this.currentState = next
    logDebug('plugin.fiber.state', { host: this.host, pluginId: this.record.id, state: next })
    this.kernel.onStateChange(this)
  }

  private createContext(): PluginContext {
    const { record } = this
    const log = createPluginLogger(record.id, this.host)
    const stack = this.stack
    const kernel = this.kernel

    return {
      bail: async (event, payload) => kernel.bus.bail(event, payload),
      config: record.config,
      effect: (setup) => {
        // Fire-and-forget on purpose: `apply` is not required to await its own
        // effects, and a rejecting setup must not take down the whole apply.
        void runEffect(stack, setup, log)
      },
      emit: (event, payload) => {
        kernel.bus.emit(event, payload)
      },
      host: this.host,
      id: record.id,
      log,
      manifest: record.manifest,
      on: <T = unknown>(event: string, listener: PluginEventListener<T>): Disposer => {
        const off = kernel.bus.on(event, listener, record.id)
        stack.add(off)
        return off
      },
      parallel: async (event, payload) => kernel.bus.parallel(event, payload),
      paths: record.paths,
      provide: (name, value) => {
        stack.add(kernel.services.provide(name, value, record.id))
      },
      rpc: {
        broadcast: (verb, payload) => {
          kernel.transport.broadcast(record.id, verb, payload)
        },
        call: async <T = unknown>(verb: string, payload?: unknown): Promise<T> =>
          (await kernel.transport.call(record.id, verb, payload)) as T,
        handle: (verb, handler) => {
          const off = kernel.registerRpcHandler(record.id, verb, handler)
          stack.add(off)
          return off
        },
      },
      serial: async (event, payload) => kernel.bus.serial(event, payload),
      service: <T = unknown>(name: string): T | undefined => kernel.services.get<T>(name),
      waterfall: async <T>(event: string, value: T) => kernel.bus.waterfall(event, value),
    }
  }

  /**
   * Imports the half, waits for its injected services, and applies it.
   * Concurrent calls share one attempt — the watcher and a manual
   * `plugin reload` can land on the same tick.
   */
  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise
    if (this.currentState === 'active' || this.currentState === 'loading') return
    this.startPromise = this.runStartOnce()
    return this.startPromise
  }

  private async runStartOnce(): Promise<void> {
    try {
      await this.runStart()
    } finally {
      this.startPromise = null
    }
  }

  private async runStart(): Promise<void> {
    this.failure = null
    this.transition('loading')
    ensurePluginDirs(this.record.id)

    let definition: PluginDefinition
    try {
      const entryPath = resolve(this.record.root, this.entry)
      const loaded = await loadPluginEntry({
        entryPath,
        half: this.host,
        pluginId: this.record.id,
        revision: this.loadRevision + 1,
      })
      definition = loaded.definition as PluginDefinition
    } catch (error) {
      this.fail(error, 'load')
      return
    }

    if (
      typeof definition !== 'object' ||
      definition === null ||
      typeof definition.apply !== 'function'
    ) {
      this.fail(
        new Error(
          `${this.host} entry must default-export definePlugin({ apply }) — got ${typeof definition}`
        ),
        'load'
      )
      return
    }

    this.injected = definition.inject ?? []
    const missing = this.kernel.services.missing(this.injected)
    if (missing.length > 0) {
      // Not a failure: the provider may still be loading. The kernel re-runs
      // `start` when the registry changes.
      logDebug('plugin.fiber.pending', { missing, pluginId: this.record.id })
      this.transition('pending')
      return
    }

    const ctx = this.createContext()
    try {
      await definition.apply(ctx)
    } catch (error) {
      // Whatever the plugin managed to register before throwing still has to
      // come back off, or a failed load leaks listeners.
      await this.stack.dispose()
      this.stack = new EffectStack()
      this.fail(error, 'apply')
      return
    }

    this.loadRevision += 1
    this.transition('active')
  }

  private fail(error: unknown, phase: 'load' | 'apply'): void {
    this.failure = error instanceof Error ? error : new Error(String(error))
    createPluginLogger(this.record.id, this.host).error(`${phase} failed`, {
      error: this.failure.message,
      ...(this.failure.stack === undefined ? {} : { stack: this.failure.stack }),
    })
    this.transition('failed')
  }

  /**
   * Unwinds every registration. Disposer errors are logged and do not stop the
   * unwind: a half-disposed fiber is the one state a reload cannot recover
   * from.
   */
  async dispose(): Promise<void> {
    if (this.currentState === 'disposed' || this.currentState === 'unloading') return
    this.transition('unloading')
    const errors = await this.stack.dispose()
    if (errors.length > 0) {
      createPluginLogger(this.record.id, this.host).error('disposers failed', {
        count: errors.length,
        errors: errors.map(String),
      })
    }
    this.stack = new EffectStack()
    this.injected = []
    this.transition('disposed')
  }

  /** Dispose then start, keeping the same record. The hot-reload path. */
  async reload(): Promise<void> {
    await this.dispose()
    this.currentState = 'pending'
    await this.start()
  }
}
