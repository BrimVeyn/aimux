import type { PluginHost, PluginManifest, PluginPaths } from '@brimveyn/aimux-plugin'

import type { BuiltinHalfLoader } from './builtin'
import type { ResolvedPluginKeymap } from './config-origin'

/**
 * How aimux came to know about a plugin. It decides two things: whether the
 * directory is aimux's to delete, and whether it is watched for edits.
 *
 * - `link`    a developer checkout registered by `aimux plugin link`. Watched.
 * - `install` cloned into `<profile>/plugins/<id>` by `aimux plugin install`.
 * - `config`  declared inline in `aimux.config.ts`. Watched, never deleted.
 * - `builtin` shipped inside aimux. No directory, so nothing to watch or
 *   delete; it is otherwise an ordinary plugin.
 */
export type PluginSource = 'link' | 'install' | 'config' | 'builtin'

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
  /**
   * Which layer decided `enabled`. The CLI reports it because it is the answer
   * to a question an agent has to ask before acting: a `plugin disable` that
   * `aimux.config.ts` will overrule at the next launch is not a disable, and
   * saying so is cheaper than letting the agent find out later.
   */
  enabledFrom: 'default' | 'registry' | 'config'
  config: Record<string, unknown>
  keymaps: ResolvedPluginKeymap[]
  paths: PluginPaths
  /**
   * Present only for `source: 'builtin'`: the halves come from the binary
   * rather than from `root`, which is not a path. Everything downstream — the
   * fiber, the effect stack, the reload — is identical.
   */
  builtin?: Partial<Record<PluginHost, BuiltinHalfLoader>>
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
