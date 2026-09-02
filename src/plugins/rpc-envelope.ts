/**
 * `ctx.rpc.call` has to work in both directions, but the IPC protocol is
 * client-initiated: the daemon can push events, not requests. So a UI → daemon
 * call is a plain `pluginRequest`/`pluginResult` pair, while a daemon → UI call
 * is an event carrying a correlation id, answered by a `pluginRequest` on the
 * reserved reply verb.
 *
 * Both directions look identical to the plugin. That is the point: if the
 * daemon half ever moves into a Worker, this file is the only thing that has
 * to know.
 */

/** Reserved verb carrying the answer to a daemon → UI call. */
export const PLUGIN_RPC_REPLY_VERB = '__reply'

/**
 * Reserved plugin id for aimux's own control channel — `plugin reload`,
 * `plugin list`. Not a legal plugin id (no dot), so it can never collide.
 */
export const PLUGIN_CONTROL_ID = 'aimux'

export const PLUGIN_CONTROL_RELOAD = 'reload'
export const PLUGIN_CONTROL_REFRESH = 'refresh'
export const PLUGIN_CONTROL_LIST = 'list'
/** Runs a plugin's CLI command in the daemon; see `src/plugins/cli-commands.ts`. */
export const PLUGIN_CONTROL_CLI_RUN = 'cli:run'

/** Verbs a plugin may not register; `__` is aimux's namespace on this channel. */
export function isReservedRpcVerb(verb: string): boolean {
  return verb.startsWith('__')
}

export interface PluginCallEnvelope {
  /** Correlates the reply. Present only on a daemon → UI call. */
  __call: string
  payload?: unknown
}

export interface PluginReplyEnvelope {
  __call: string
  ok: boolean
  result?: unknown
  error?: string
}

export function isCallEnvelope(value: unknown): value is PluginCallEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PluginCallEnvelope).__call === 'string'
  )
}

export function isReplyEnvelope(value: unknown): value is PluginReplyEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PluginReplyEnvelope).__call === 'string' &&
    typeof (value as PluginReplyEnvelope).ok === 'boolean'
  )
}
