import type { PluginConfigEntry } from '@brimveyn/aimux-config'

import { useEffect, useRef, useState } from 'react'

import type { PluginRpcTransport, PluginStatus } from '../plugins/types'
import type { SessionBackend } from '../session-backend/types'

import { logDebug } from '../debug/input-log'
import { PluginRuntime } from '../plugins/loader'
import {
  isCallEnvelope,
  PLUGIN_CONTROL_ID,
  PLUGIN_CONTROL_REFRESH,
  PLUGIN_CONTROL_RELOAD,
  PLUGIN_RPC_REPLY_VERB,
} from '../plugins/rpc-envelope'
import { toast } from '../state/toast-store'

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
}

export interface PluginHostHandle {
  statuses: PluginStatus[]
  /** Bumped on every status change so registry consumers can re-render. */
  version: number
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

  useEffect(() => {
    let stopped = false

    const transport: PluginRpcTransport = {
      broadcast: (pluginId, verb, payload) => {
        // No fanout primitive on this side: a UI broadcast is a call whose
        // answer nobody waits for.
        void backend.pluginRequest?.(pluginId, verb, payload).catch((error: unknown) => {
          logDebug('ui.plugin.broadcastFailed', { error: String(error), pluginId, verb })
        })
      },
      call: async (pluginId, verb, payload) => {
        if (!backend.pluginRequest) {
          throw new Error('this session has no daemon; plugin RPC is unavailable')
        }
        return backend.pluginRequest(pluginId, verb, payload)
      },
    }

    const runtime = new PluginRuntime({
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
     * Answers a daemon → UI call. The reply travels back as an ordinary
     * `pluginRequest` on the reserved verb, which the daemon's host
     * intercepts before any plugin dispatch.
     */
    const reply = (callId: string, ok: boolean, result: unknown, error?: string): void => {
      void backend
        .pluginRequest?.(PLUGIN_CONTROL_ID, PLUGIN_RPC_REPLY_VERB, {
          __call: callId,
          error,
          ok,
          result,
        })
        .catch((sendError: unknown) => {
          logDebug('ui.plugin.replyFailed', { callId, error: String(sendError) })
        })
    }

    const onPluginEvent = (pluginId: string, verb: string, payload: unknown): void => {
      if (pluginId === PLUGIN_CONTROL_ID) {
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
        void runtime.kernel
          .handleRpc(pluginId, verb, payload.payload)
          .then((result) => {
            reply(payload.__call, true, result)
          })
          .catch((error: unknown) => {
            reply(
              payload.__call,
              false,
              undefined,
              error instanceof Error ? error.message : String(error)
            )
          })
        return
      }

      runtime.kernel.deliverBroadcast(pluginId, verb, payload)
    }

    backend.on('pluginEvent', onPluginEvent)
    void runtime.start()

    return () => {
      stopped = true
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
