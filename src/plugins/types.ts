import type { PluginHost, PluginManifest, PluginPaths } from '@brimveyn/aimux-plugin'

/**
 * How aimux came to know about a plugin. It decides two things: whether the
 * directory is aimux's to delete, and whether it is watched for edits.
 *
 * - `link`    a developer checkout registered by `aimux plugin link`. Watched.
 * - `install` cloned into `<profile>/plugins/<id>` by `aimux plugin install`.
 * - `config`  declared inline in `aimux.config.ts`. Watched, never deleted.
 */
export type PluginSource = 'link' | 'install' | 'config'

/**
 * One plugin as the host sees it before any of its code has run: where it
 * lives, what it declares, and what configuration it will receive.
 */
export interface PluginRecord {
  id: string
  manifest: PluginManifest
  /** Absolute path to the plugin directory. */
  root: string
  source: PluginSource
  enabled: boolean
  config: Record<string, unknown>
  paths: PluginPaths
}

/**
 * Crossing the process boundary to this plugin's other half. Supplied by the
 * host that owns the socket — the daemon serves requests, the UI issues them —
 * so the kernel itself knows nothing about IPC.
 */
export interface PluginRpcTransport {
  call: (pluginId: string, verb: string, payload: unknown) => Promise<unknown>
  broadcast: (pluginId: string, verb: string, payload: unknown) => void
}

export type FiberState = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | 'disposed'

/** What `aimux plugin list` prints, and what the UI renders. */
export interface PluginStatus {
  id: string
  name: string
  version: string
  host: PluginHost
  source: PluginSource
  enabled: boolean
  state: FiberState
  root: string
  /** Present only in `failed`. */
  error?: string
  /** Services the fiber is still waiting on, when `pending`. */
  missing?: string[]
  /** Live disposers — a rough measure of how much the plugin has registered. */
  effects: number
  /** Bumped on every successful (re)load. */
  revision: number
}
