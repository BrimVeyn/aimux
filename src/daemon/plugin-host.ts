import type { PluginConfigEntry } from '@brimveyn/aimux-config'

import type { PluginDiscoveryIssue } from '../plugins/discovery'
import type { PluginRpcTransport, PluginStatus } from '../plugins/types'

import { logDebug } from '../debug/input-log'
import { PluginRuntime } from '../plugins/loader'
import {
  isReplyEnvelope,
  PLUGIN_CONTROL_ID,
  PLUGIN_CONTROL_LIST,
  PLUGIN_CONTROL_REFRESH,
  PLUGIN_CONTROL_RELOAD,
  PLUGIN_RPC_REPLY_VERB,
} from '../plugins/rpc-envelope'
import { type DaemonEventName, onDaemonEvent } from './daemon-events'

/**
 * The daemon's plugin host, extracted from `daemon.ts` from the start: that
 * file is already at 1429 lines against a 1000-line lint cap, and the plugin
 * surface only grows from here.
 *
 * Two responsibilities. It owns the daemon-half kernel, and it is the RPC
 * switchboard — the daemon socket is the only path between the two halves of
 * any plugin, so both directions land here.
 */

/** A daemon → UI call that has not been answered yet. */
interface PendingOutboundCall {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const OUTBOUND_CALL_TIMEOUT_MS = 10_000

/**
 * Every event forwarded to plugins. Listed rather than derived, because the
 * list *is* the published vocabulary: adding an event to `DaemonEvents` should
 * be a decision to expose it, not a side effect of declaring it.
 */
const DAEMON_EVENT_NAMES: readonly DaemonEventName[] = [
  'tab:status',
  'tab:turnComplete',
  'tab:question',
  'tab:added',
  'project:status',
  'project:created',
  'project:switched',
  'project:closed',
  'workspace:added',
  'workspace:removed',
  'daemon:reexec',
]

export interface PluginEventPayload {
  pluginId: string
  verb: string
  payload?: unknown
}

export interface DaemonPluginHostOptions {
  userPlugins: readonly PluginConfigEntry[]
  /**
   * Fan an event out to every attached client that negotiated v19 and is not
   * a thin CLI attacher. Supplied by `daemon.ts`, which owns the socket set.
   */
  broadcast: (event: PluginEventPayload) => void
  /** Whether any UI process is currently attached — gates daemon → UI calls. */
  hasUiClient: () => boolean
}

export interface DaemonPluginHost {
  runtime: PluginRuntime
  /** Routes an incoming `pluginRequest`. Resolves with the `pluginResult` body. */
  handleRequest: (pluginId: string, verb: string, payload: unknown) => Promise<unknown>
  /** Publishes a host event onto the daemon-side bus. */
  emit: (event: string, payload?: unknown) => void
  statuses: () => PluginStatus[]
  issues: () => readonly PluginDiscoveryIssue[]
  stop: () => Promise<void>
}

export async function startDaemonPluginHost(
  options: DaemonPluginHostOptions
): Promise<DaemonPluginHost> {
  const pending = new Map<string, PendingOutboundCall>()

  const settle = (callId: string, apply: (entry: PendingOutboundCall) => void): void => {
    const entry = pending.get(callId)
    if (!entry) return
    clearTimeout(entry.timer)
    pending.delete(callId)
    apply(entry)
  }

  const transport: PluginRpcTransport = {
    broadcast: (pluginId, verb, payload) => {
      options.broadcast({ payload, pluginId, verb })
    },
    /**
     * Daemon → UI. The protocol has no server-initiated request, so the call
     * goes out as an event carrying a correlation id and comes back as a
     * `pluginRequest` on the reserved reply verb.
     */
    call: async (pluginId, verb, payload) => {
      if (!options.hasUiClient()) {
        throw new Error(`no UI half attached to answer ${pluginId}.${verb}`)
      }
      const callId = crypto.randomUUID()
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(callId)
          reject(
            new Error(
              `plugin rpc call timed out after ${OUTBOUND_CALL_TIMEOUT_MS}ms: ${pluginId}.${verb}`
            )
          )
        }, OUTBOUND_CALL_TIMEOUT_MS)
        pending.set(callId, { reject, resolve, timer })
        options.broadcast({ payload: { __call: callId, payload }, pluginId, verb })
      })
    },
  }

  const runtime = new PluginRuntime({
    host: 'daemon',
    onIssues: (issues) => {
      for (const issue of issues) {
        logDebug('daemon.plugin.issue', { ...issue })
      }
    },
    transport,
    userPlugins: options.userPlugins,
  })

  // Bridge the daemon's own event bus onto the kernel's, so `ctx.on('tab:...')`
  // works without a plugin knowing either bus exists. Kept as a bridge rather
  // than one bus: the daemon's is typed to aimux's vocabulary and fires inside
  // the status loop, the kernel's is string-keyed and shared with RPC — and a
  // plugin listener must not be able to run inside the loop that produced the
  // event.
  const unbridge = DAEMON_EVENT_NAMES.map((event) =>
    onDaemonEvent(event, (payload) => {
      runtime.kernel.emit(event, payload)
    })
  )

  await runtime.start()
  logDebug('daemon.pluginHost.started', {
    plugins: runtime.statuses().map((status) => `${status.id}:${status.state}`),
  })

  /**
   * aimux's own control channel, reserved under the `aimux` pluginId (not a
   * legal plugin id, so it can never collide). `aimux plugin reload` lands
   * here, reloads the daemon halves, and forwards the same instruction to
   * every UI so both processes reload from one command.
   */
  const handleControl = async (verb: string, payload: unknown): Promise<unknown> => {
    const id =
      typeof (payload as { id?: unknown } | undefined)?.id === 'string'
        ? (payload as { id: string }).id
        : undefined

    switch (verb) {
      case PLUGIN_CONTROL_RELOAD: {
        await runtime.reload(id)
        options.broadcast({
          payload: { id },
          pluginId: PLUGIN_CONTROL_ID,
          verb: PLUGIN_CONTROL_RELOAD,
        })
        return { reloaded: runtime.statuses() }
      }
      case PLUGIN_CONTROL_REFRESH: {
        await runtime.refresh()
        options.broadcast({
          payload: {},
          pluginId: PLUGIN_CONTROL_ID,
          verb: PLUGIN_CONTROL_REFRESH,
        })
        return { plugins: runtime.statuses() }
      }
      case PLUGIN_CONTROL_LIST:
        return {
          issues: runtime.issues,
          known: runtime.knownRecords().map((record) => ({
            enabled: record.enabled,
            halves: Object.keys(record.manifest.entries ?? {}),
            id: record.id,
            name: record.manifest.name ?? record.id,
            root: record.root,
            source: record.source,
            version: record.manifest.version,
          })),
          plugins: runtime.statuses(),
        }
      default:
        throw new Error(`unknown plugin control verb: ${verb}`)
    }
  }

  return {
    emit: (event, payload) => {
      runtime.kernel.emit(event, payload)
    },
    handleRequest: async (pluginId, verb, payload) => {
      // The reply verb is checked before anything else, including the control
      // channel: a reply travels under the reserved `aimux` id because it is
      // aimux's plumbing rather than the plugin's, and routing it to
      // `handleControl` would strand the promise it was sent to settle.
      if (verb === PLUGIN_RPC_REPLY_VERB) {
        if (!isReplyEnvelope(payload)) {
          throw new Error('malformed plugin rpc reply envelope')
        }
        settle(payload.__call, (entry) => {
          if (payload.ok) entry.resolve(payload.result)
          else entry.reject(new Error(payload.error ?? 'plugin rpc call failed in the UI half'))
        })
        return {}
      }

      if (pluginId === PLUGIN_CONTROL_ID) return handleControl(verb, payload)

      return runtime.kernel.handleRpc(pluginId, verb, payload)
    },
    issues: () => runtime.issues,
    runtime,
    statuses: () => runtime.statuses(),
    stop: async () => {
      for (const [, entry] of pending) {
        clearTimeout(entry.timer)
        entry.reject(new Error('daemon plugin host stopped'))
      }
      pending.clear()
      for (const dispose of unbridge) dispose()
      await runtime.stop()
    },
  }
}
