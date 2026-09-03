import type {
  PluginAssistantsApi,
  PluginCliApi,
  PluginHooksApi,
  PluginMetricsApi,
  PluginProjectsApi,
  PluginTabsApi,
  PluginWorkspacesApi,
} from './daemon-api'
import type { PluginHost, PluginManifest } from './manifest'
import type { PluginActionsApi, PluginStoreApi, PluginUiApi } from './ui'

/**
 * Everything a plugin registers hands back one of these. The kernel calls
 * every disposer a fiber collected before it re-imports the module, which is
 * what makes hot reload safe by construction rather than by discipline.
 */
export type Disposer = () => void | Promise<void>

export interface PluginLogger {
  debug: (message: string, data?: Record<string, unknown>) => void
  info: (message: string, data?: Record<string, unknown>) => void
  warn: (message: string, data?: Record<string, unknown>) => void
  error: (message: string, data?: Record<string, unknown>) => void
}

export interface PluginPaths {
  /** The plugin's own directory — read-only as far as the plugin is concerned. */
  root: string
  /** `<profile>/plugins-config/<id>`: files a human is expected to edit. */
  config: string
  /** `<profile>/plugins-state/<id>`: caches, databases, anything disposable. */
  state: string
  /** `<state>/plugin.log`, where `ctx.log` and load failures are written. */
  log: string
}

export type PluginEventListener<T = never> = (payload: T) => unknown

/**
 * Five dispatch modes, after Cordis. `emit` is the one you want unless you
 * need a result: it never awaits and never lets one listener's rejection
 * reach another.
 */
export interface PluginEventDispatch {
  /** Fire and forget. Rejections are logged against the emitting plugin. */
  emit: (event: string, payload?: unknown) => void
  /** All listeners at once; resolves with every result. */
  parallel: (event: string, payload?: unknown) => Promise<unknown[]>
  /** One listener at a time, in registration order. */
  serial: (event: string, payload?: unknown) => Promise<unknown[]>
  /** Stops at the first listener returning something other than `undefined`. */
  bail: <T>(event: string, payload?: unknown) => Promise<T | undefined>
  /** Threads a value through every listener; each returns the next input. */
  waterfall: <T>(event: string, value: T) => Promise<T>
}

/**
 * Talk to this plugin's other half. `call` crosses the process boundary
 * (UI ⇄ daemon) over aimux's existing IPC socket; the payload is opaque to
 * the protocol, which validates the envelope once and never the contents.
 *
 * A plugin with only one half still gets `rpc` — `call` simply rejects with
 * "no handler", which is also what an unhandled verb does.
 */
export interface PluginRpc {
  call: <T = unknown>(verb: string, payload?: unknown) => Promise<T>
  handle: (verb: string, handler: (payload: unknown) => unknown) => Disposer
  /** One-way fanout to every live instance of the other half. */
  broadcast: (verb: string, payload?: unknown) => void
}

/**
 * The object a plugin's `apply` receives. Services beyond this base
 * (`ctx.ui.*`, `ctx.assistants`, `ctx.tabs`…) arrive in later API phases and
 * are always reached through `inject`, so a plugin that asks for one it does
 * not get stays `pending` instead of crashing.
 */
export interface PluginContext {
  readonly id: string
  readonly manifest: PluginManifest
  /** Which process this half is running in. */
  readonly host: PluginHost
  readonly log: PluginLogger
  /** Merged and defaulted from the manifest schema, the registry and user config. */
  readonly config: Record<string, unknown>
  readonly paths: PluginPaths
  readonly rpc: PluginRpc

  /**
   * Register teardown. The setup function runs immediately (awaited when it
   * returns a promise); the disposer it returns runs on unload, in reverse
   * registration order. Anything a plugin allocates — a timer, a watcher, a
   * socket — belongs in here.
   */
  effect: (setup: () => Disposer | void | Promise<Disposer | void>) => void

  /** Subscribe to a host or plugin event. Auto-disposed on unload. */
  on: <T = unknown>(event: string, listener: PluginEventListener<T>) => Disposer

  emit: PluginEventDispatch['emit']
  parallel: PluginEventDispatch['parallel']
  serial: PluginEventDispatch['serial']
  bail: PluginEventDispatch['bail']
  waterfall: PluginEventDispatch['waterfall']

  /**
   * Publish a service other plugins may `inject`. Withdrawn automatically on
   * unload, which unloads whoever injected it.
   */
  provide: (name: string, value: unknown) => void
  /** Read a service. Prefer `inject` — it makes the dependency load-ordered. */
  service: <T = unknown>(name: string) => T | undefined
}

/**
 * The UI half's context. `ui`, `actions` and `store` are attached by the UI
 * host; a plugin declaring `entries.ui` always receives them.
 */
export interface UiPluginContext<Slice = unknown> extends PluginContext {
  readonly host: 'ui'
  readonly ui: PluginUiApi
  readonly actions: PluginActionsApi
  readonly store: PluginStoreApi<Slice>
}

/**
 * The daemon half's context. Attached by the daemon host; a plugin declaring
 * `entries.daemon` always receives them.
 */
export interface DaemonPluginContext extends PluginContext {
  readonly host: 'daemon'
  readonly tabs: PluginTabsApi
  readonly projects: PluginProjectsApi
  readonly workspaces: PluginWorkspacesApi
  readonly assistants: PluginAssistantsApi
  readonly hooks: PluginHooksApi
  readonly cli: PluginCliApi
  readonly metrics: PluginMetricsApi
}

export interface PluginDefinition<Ctx extends PluginContext = PluginContext> {
  /** Diagnostic label. Defaults to the manifest id plus the half. */
  name?: string
  /**
   * Services this half needs. The fiber stays `pending` until every one is
   * provided, then applies; if one is later withdrawn the fiber unloads.
   */
  inject?: readonly string[]
  apply: (ctx: Ctx) => void | Promise<void>
}
