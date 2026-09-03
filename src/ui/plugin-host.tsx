import type { PluginConfigEntry } from '@brimveyn/aimux-config'

import { useEffect, useRef, useState } from 'react'

import type { BuiltinPlugin } from '../plugins/builtin'
import type { PluginRpcTransport, PluginStatus } from '../plugins/types'
import type { SessionBackend } from '../session-backend/types'

import { logDebug } from '../debug/input-log'
import { PluginRuntime } from '../plugins/loader'
import { publishPluginRecords, publishPluginStatuses } from '../plugins/plugin-store'
import {
  isCallEnvelope,
  PLUGIN_CONTROL_ID,
  PLUGIN_CONTROL_KEYMAP_RESOLVE,
  PLUGIN_CONTROL_REFRESH,
  PLUGIN_CONTROL_RELOAD,
  PLUGIN_CONTROL_UI_STATE,
  PLUGIN_CONTROL_UI_VERBS,
  PLUGIN_RPC_REPLY_VERB,
  type PluginCallEnvelope,
} from '../plugins/rpc-envelope'
import { onSettingSectionsChanged } from '../settings/sections'
import { dispatchGlobal } from '../state/dispatch-ref'
import { onStatsPagesChanged } from '../state/stats-pages'
import { toast } from '../state/toast-store'
import { describeUiState, resolveKeymap, runPluginActionByName } from './introspection'
import { setUiPluginEmitter } from './plugin-events-ref'
import { onPluginModalsChanged } from './plugin-modals'
import { onPluginPanesChanged } from './plugin-panes'
import { setPluginRefresh } from './plugin-refresh-ref'
import { extendUiPluginContext } from './plugin-ui-services'
import { onPluginViewsChanged } from './plugin-views'
import { onBarWidgetsChanged } from './widgets/registry'

/**
 * The UI's plugin host, extracted from `app.tsx` from the start — that file is
 * already the largest in the tree and the UI plugin surface only grows.
 *
 * It mirrors `src/daemon/plugin-host.ts`: same runtime, same kernel, a
 * transport pointed the other way. The asymmetry is only in how a call
 * travels — UI → daemon is a plain request, daemon → UI is an event carrying a
 * correlation id that this host answers on the reserved reply verb.
 */

export interface UsePluginHostOptions {
  backend: SessionBackend
  /** `resolvedConfig.plugins`. Read once: config is not reloaded at runtime. */
  userPlugins: readonly PluginConfigEntry[]
  /** The plugins aimux ships. Supplied by `app.tsx`, which has the config. */
  builtins: readonly BuiltinPlugin[]
}

export interface PluginHostHandle {
  statuses: PluginStatus[]
  /** Bumped on every status change so registry consumers can re-render. */
  version: number
}

/**
 * Every UI → daemon message is fire-and-forget except a plugin's own
 * `ctx.rpc.call`; a failure has no caller waiting and belongs in the debug log.
 */
async function send(
  backend: SessionBackend,
  pluginId: string,
  verb: string,
  payload: unknown,
  event: string
): Promise<void> {
  try {
    // Called as a method, not detached: the remote backend's implementation
    // reaches for `this.send` and the negotiated capability set.
    await backend.pluginRequest?.(pluginId, verb, payload)
  } catch (error) {
    logDebug(event, { error: String(error), pluginId, verb })
  }
}

export function usePluginHost(options: UsePluginHostOptions): PluginHostHandle {
  const [statuses, setStatuses] = useState<PluginStatus[]>([])
  const [version, setVersion] = useState(0)
  const runtimeRef = useRef<PluginRuntime | null>(null)
  const { backend } = options
  // Read through a ref: `userPlugins` is a fresh array identity on every
  // render, and the host must be created exactly once per app instance.
  const userPluginsRef = useRef(options.userPlugins)
  userPluginsRef.current = options.userPlugins
  const builtinsRef = useRef(options.builtins)
  builtinsRef.current = options.builtins

  useEffect(() => {
    let stopped = false

    const transport: PluginRpcTransport = {
      broadcast: (pluginId, verb, payload) => {
        // No fanout primitive on this side: a UI broadcast is a call whose
        // answer nobody waits for.
        void send(backend, pluginId, verb, payload, 'ui.plugin.broadcastFailed')
      },
      call: async (pluginId, verb, payload) => {
        if (!backend.pluginRequest) {
          throw new Error('this session has no daemon; plugin RPC is unavailable')
        }
        return backend.pluginRequest(pluginId, verb, payload)
      },
    }

    const runtime = new PluginRuntime({
      builtins: builtinsRef.current,
      extendContext: extendUiPluginContext,
      host: 'ui',
      onIssues: (issues) => {
        // Discovery problems are the user's to fix, and a plugin that silently
        // fails to load is the worst outcome available — so they surface.
        for (const issue of issues) {
          toast.error(`plugin: ${issue.message}`)
        }
      },
      onStatusChange: (next) => {
        if (stopped) return
        setStatuses(next)
        setVersion((value) => value + 1)
        publishPluginStatuses(next)
        // The records too: a status change follows every `kernel.apply`, which
        // follows every refresh, so this is where the two are both current.
        publishPluginRecords(
          runtimeRef.current?.knownRecords() ?? [],
          runtimeRef.current?.issues ?? []
        )
        for (const status of next) {
          if (status.state === 'failed' && status.error !== undefined) {
            toast.error(`plugin ${status.id}: ${status.error}`)
          }
        }
      },
      transport,
      userPlugins: userPluginsRef.current,
    })
    runtimeRef.current = runtime

    /**
     * Re-read the plugins here and in the daemon. The daemon's `refresh`
     * broadcasts back to every attached UI, so a settings write reaches both
     * processes with one call — and the local refresh covers the daemonless
     * case, where this process is the only one there is.
     */
    const refreshEverywhere = (): void => {
      void runtime.refresh()
      void send(backend, PLUGIN_CONTROL_ID, PLUGIN_CONTROL_REFRESH, {}, 'ui.plugin.refreshFailed')
    }
    setPluginRefresh(refreshEverywhere)

    /**
     * Answers a daemon → UI call. The reply travels back as an ordinary
     * `pluginRequest` on the reserved verb, which the daemon's host
     * intercepts before any plugin dispatch.
     */
    const reply = (callId: string, ok: boolean, result: unknown, error?: string): void => {
      void send(
        backend,
        PLUGIN_CONTROL_ID,
        PLUGIN_RPC_REPLY_VERB,
        { __call: callId, error, ok, result },
        'ui.plugin.replyFailed'
      )
    }

    /** Answers a daemon → UI call, then sends the outcome back either way. */
    const answer = async (
      pluginId: string,
      verb: string,
      envelope: PluginCallEnvelope
    ): Promise<void> => {
      try {
        reply(
          envelope.__call,
          true,
          await runtime.kernel.handleRpc(pluginId, verb, envelope.payload)
        )
      } catch (error) {
        reply(
          envelope.__call,
          false,
          undefined,
          error instanceof Error ? error.message : String(error)
        )
      }
    }

    /**
     * The three verbs only this process can answer: what the screen shows, what
     * a key resolves to, and running an action the way a press would. They
     * arrive as ordinary calls on the reserved control id, forwarded by the
     * daemon on behalf of the CLI.
     */
    const answerControl = (verb: string, envelope: PluginCallEnvelope): void => {
      try {
        const payload = envelope.payload as { keys?: string; mode?: string; name?: string }
        if (verb === PLUGIN_CONTROL_UI_STATE) {
          reply(envelope.__call, true, describeUiState())
          return
        }
        if (verb === PLUGIN_CONTROL_KEYMAP_RESOLVE) {
          reply(
            envelope.__call,
            true,
            resolveKeymap(
              typeof payload.keys === 'string' ? payload.keys : '',
              typeof payload.mode === 'string' ? payload.mode : undefined
            )
          )
          return
        }
        reply(
          envelope.__call,
          true,
          runPluginActionByName(typeof payload.name === 'string' ? payload.name : '')
        )
      } catch (error) {
        reply(
          envelope.__call,
          false,
          undefined,
          error instanceof Error ? error.message : String(error)
        )
      }
    }

    const onPluginEvent = (pluginId: string, verb: string, payload: unknown): void => {
      if (pluginId === PLUGIN_CONTROL_ID) {
        if (PLUGIN_CONTROL_UI_VERBS.includes(verb) && isCallEnvelope(payload)) {
          answerControl(verb, payload)
          return
        }
        if (verb === PLUGIN_CONTROL_RELOAD) {
          const id =
            typeof (payload as { id?: unknown })?.id === 'string'
              ? (payload as { id: string }).id
              : undefined
          void runtime.reload(id)
          return
        }
        if (verb === PLUGIN_CONTROL_REFRESH) {
          void runtime.refresh()
        }
        return
      }

      if (isCallEnvelope(payload)) {
        void answer(pluginId, verb, payload)
        return
      }

      runtime.kernel.deliverBroadcast(pluginId, verb, payload)
    }

    // A widget, view or modal lives in a registry rather than in the store, so
    // React has no way to learn it changed. Every registry change bumps one
    // number the hosting components subscribe to; that is the whole mechanism
    // behind a hot-reloaded view repainting.
    const bump = (): void => {
      dispatchGlobal({ type: 'bump-plugin-registry' })
    }
    const unwatchRegistries = [
      onPluginViewsChanged(bump),
      onPluginModalsChanged(bump),
      onPluginPanesChanged(bump),
      onBarWidgetsChanged(bump),
      onSettingSectionsChanged(bump),
      onStatsPagesChanged(bump),
    ]

    backend.on('pluginEvent', onPluginEvent)
    // aimux's own UI events reach plugins through this: a call site emits
    // without importing the kernel, and emits into nothing before we mount.
    setUiPluginEmitter((event, payload) => {
      runtime.kernel.emit(event, payload)
    })
    void runtime.start()

    return () => {
      stopped = true
      setPluginRefresh(null)
      setUiPluginEmitter(null)
      for (const unwatch of unwatchRegistries) unwatch()
      backend.off('pluginEvent', onPluginEvent)
      void runtime.stop()
      runtimeRef.current = null
    }
    // One host per app instance. `backend` is stable for the app's lifetime;
    // `userPlugins` is read through a ref for the same reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend])

  return { statuses, version }
}
