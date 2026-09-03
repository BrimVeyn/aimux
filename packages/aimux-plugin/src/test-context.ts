import type {
  Disposer,
  PluginContext,
  PluginDefinition,
  PluginEventListener,
  PluginPaths,
} from './types'

import { EffectStack } from './effects'
import { PluginEventBus } from './event-bus'
import { PLUGIN_API_VERSION, type PluginHost, type PluginManifest } from './manifest'
import { createTestUiSurface, type TestUiSurface } from './test-ui'

export interface TestLogEntry {
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  data?: Record<string, unknown>
}

export interface TestRpcCall {
  verb: string
  payload: unknown
}

export interface TestContextOptions {
  id?: string
  host?: PluginHost
  config?: Record<string, unknown>
  manifest?: Partial<PluginManifest>
  paths?: Partial<PluginPaths>
  /** Services the plugin can read through `ctx.service(...)`. */
  services?: Record<string, unknown>
  /**
   * Stands in for the other half. Return a value (or a promise) to resolve
   * `ctx.rpc.call`; leave it out and every call rejects the way an unhandled
   * verb does in production.
   */
  onCall?: (verb: string, payload: unknown) => unknown
  /**
   * Attaches host services to the context, the way the real hosts do through
   * the kernel's `extendContext`. Without it a plugin that touches `ctx.ui` or
   * `ctx.tabs` cannot be applied here at all — which is what made
   * `aimux plugin doctor` unable to check the plugins that need checking most.
   *
   * A test usually wants recording stubs; `doctor` supplies exactly that.
   */
  extend?: (ctx: PluginContext) => void
}

export interface TestContextHandle {
  ctx: PluginContext
  bus: PluginEventBus
  /** Every `ctx.log.*` line, in order. */
  logs: TestLogEntry[]
  /** Every `ctx.rpc.call` the plugin made. */
  calls: TestRpcCall[]
  /** Every `ctx.rpc.broadcast` the plugin sent. */
  broadcasts: TestRpcCall[]
  /** Services the plugin published via `ctx.provide`. */
  provided: Map<string, unknown>
  /**
   * Run a definition's `apply` against this context. Generic so an inline
   * `{ apply(ctx) { … } }` infers the base context and a typed
   * `PluginDefinition<UiPluginContext>` is accepted as written.
   */
  apply: <Ctx extends PluginContext = PluginContext>(
    definition: PluginDefinition<Ctx>
  ) => Promise<void>
  /** Call a verb the plugin registered with `ctx.rpc.handle`. */
  invoke: <T = unknown>(verb: string, payload?: unknown) => Promise<T>
  /** Verbs the plugin currently handles. */
  handledVerbs: () => string[]
  /** How many disposers the plugin has registered and not yet released. */
  effectCount: () => number
  /** Unwind, exactly as an unload would. Resolves with any disposer errors. */
  dispose: () => Promise<unknown[]>
  /**
   * The recording UI half, when `host` is `'ui'` and no `extend` replaced it:
   * what the plugin registered, the toasts it raised, and the levers that drive
   * `ctx.ui.state`, `ctx.ui.settings` and `ctx.ui.themes`. Absent for a daemon
   * plugin, which has no `ctx.ui` to record.
   */
  ui?: TestUiSurface
}

/**
 * A standalone plugin context for tests, with no aimux process behind it.
 * The event bus and effect stack are the real implementations, so `bail`,
 * `waterfall` and disposal ordering behave as they do at runtime; only the
 * process-crossing parts (RPC, filesystem paths) are stubs the test drives.
 *
 * ```ts
 * const t = createTestContext({ config: { botToken: 'x' } })
 * await t.apply(plugin)
 * t.bus.emit('tab:turnComplete', { tabId: 't1' })
 * expect(t.calls).toHaveLength(1)
 * await t.dispose()
 * expect(t.effectCount()).toBe(0)
 * ```
 */
export function createTestContext(options: TestContextOptions = {}): TestContextHandle {
  const id = options.id ?? 'test.plugin'
  const host: PluginHost = options.host ?? 'daemon'
  const logs: TestLogEntry[] = []
  const calls: TestRpcCall[] = []
  const broadcasts: TestRpcCall[] = []
  const provided = new Map<string, unknown>()
  const handlers = new Map<string, (payload: unknown) => unknown>()
  const services = new Map<string, unknown>(Object.entries(options.services ?? {}))

  const bus = new PluginEventBus({
    onError: (error, context) => {
      logs.push({
        data: { error: String(error), event: context.event },
        level: 'error',
        message: 'listener failed',
      })
    },
  })
  const effects = new EffectStack()

  const record =
    (level: TestLogEntry['level']) =>
    (message: string, data?: Record<string, unknown>): void => {
      logs.push(data === undefined ? { level, message } : { data, level, message })
    }

  const manifest: PluginManifest = {
    apiVersion: PLUGIN_API_VERSION,
    id,
    name: id,
    version: '0.0.0',
    ...options.manifest,
  }

  const paths: PluginPaths = {
    config: `/tmp/aimux-test/${id}/config`,
    log: `/tmp/aimux-test/${id}/state/plugin.log`,
    root: `/tmp/aimux-test/${id}`,
    state: `/tmp/aimux-test/${id}/state`,
    ...options.paths,
  }

  const ctx: PluginContext = {
    bail: async (event, payload) => bus.bail(event, payload),
    config: options.config ?? {},
    effect: (setup) => {
      void effects.run(setup)
    },
    emit: (event, payload) => {
      bus.emit(event, payload)
    },
    host,
    id,
    log: {
      debug: record('debug'),
      error: record('error'),
      info: record('info'),
      warn: record('warn'),
    },
    manifest,
    on: <T = unknown>(event: string, listener: PluginEventListener<T>): Disposer => {
      const off = bus.on(event, listener, id)
      effects.add(off)
      return off
    },
    parallel: async (event, payload) => bus.parallel(event, payload),
    paths,
    provide: (name, value) => {
      provided.set(name, value)
      services.set(name, value)
      effects.add(() => {
        provided.delete(name)
        services.delete(name)
      })
    },
    rpc: {
      broadcast: (verb, payload) => {
        broadcasts.push({ payload, verb })
      },
      call: async <T = unknown>(verb: string, payload?: unknown): Promise<T> => {
        calls.push({ payload, verb })
        if (!options.onCall) {
          throw new Error(`no handler for plugin rpc verb: ${id}.${verb}`)
        }
        return (await options.onCall(verb, payload)) as T
      },
      handle: (verb, handler) => {
        handlers.set(verb, handler)
        const off = (): void => {
          if (handlers.get(verb) === handler) handlers.delete(verb)
        }
        effects.add(off)
        return off
      },
    },
    serial: async (event, payload) => bus.serial(event, payload),
    service: <T = unknown>(name: string): T | undefined => services.get(name) as T | undefined,
    waterfall: async <T>(event: string, value: T) => bus.waterfall(event, value),
  }

  /**
   * A UI plugin's first line is `ctx.ui.something.register(...)`, so a `ui`
   * context without `ctx.ui` cannot run one at all. `extend` still wins: the
   * real hosts and `plugin doctor` pass their own services, and this stub is
   * what an author outside aimux gets instead.
   */
  const surface = host === 'ui' ? createTestUiSurface(effects) : undefined
  if (surface) {
    const extended = ctx as PluginContext & {
      ui: unknown
      actions: unknown
      store: unknown
    }
    extended.ui = surface.ui
    extended.actions = surface.actions
    extended.store = surface.store
  }

  options.extend?.(ctx)

  return {
    ...(surface === undefined ? {} : { ui: surface }),
    apply: async (definition) => {
      await (definition as PluginDefinition).apply(ctx)
    },
    broadcasts,
    bus,
    calls,
    ctx,
    dispose: async () => effects.dispose(),
    effectCount: () => effects.size,
    handledVerbs: () => [...handlers.keys()],
    invoke: async <T = unknown>(verb: string, payload?: unknown): Promise<T> => {
      const handler = handlers.get(verb)
      if (!handler) throw new Error(`no handler for plugin rpc verb: ${id}.${verb}`)
      return (await handler(payload)) as T
    },
    logs,
    provided,
  }
}
