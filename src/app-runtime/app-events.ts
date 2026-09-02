import type { AppAction, AppState, SideEffect } from '@brimveyn/aimux-config'

import { logDebug } from '../debug/input-log'

/**
 * The UI process's event bus. Two things already funnelled through a single
 * point — every dispatch that changed state, and every side effect executed —
 * and each had exactly one hard-wired consumer: the usage counters.
 *
 * Making that a bus rather than a call is what lets a plugin see the same
 * stream. The counters become the first subscriber and lose their privileged
 * position; nothing else about them changes.
 *
 * Deliberately not the plugin kernel's bus. This one is synchronous, typed to
 * aimux's own vocabulary, and runs inside `dispatch` — the kernel bus is
 * string-keyed and reaches across processes. The UI plugin host bridges the
 * two, which keeps a plugin's mistake from landing inside a store update.
 */

export interface AppEvents {
  /** A dispatch that actually changed the state. Declined actions do not fire. */
  action: { action: AppAction; before: AppState; after: AppState }
  /** A side effect about to run. Fires before the effect, not after. */
  effect: { effect: SideEffect }
}

type Listener<K extends keyof AppEvents> = (payload: AppEvents[K]) => void

const listeners: { [K in keyof AppEvents]: Set<Listener<K>> } = {
  action: new Set(),
  effect: new Set(),
}

export function onAppEvent<K extends keyof AppEvents>(event: K, listener: Listener<K>): () => void {
  listeners[event].add(listener)
  return () => {
    listeners[event].delete(listener)
  }
}

/**
 * Fires an event. A throwing subscriber is contained: this runs inside
 * `dispatch` and inside the effect executor, and a plugin listener must not be
 * able to abort a store update or the effects queued behind it.
 */
export function emitAppEvent<K extends keyof AppEvents>(event: K, payload: AppEvents[K]): void {
  // Snapshot: a listener that unsubscribes on its first call must not shift
  // the set under the loop.
  const current = [...listeners[event]] as Listener<K>[]
  for (const listener of current) {
    try {
      listener(payload)
    } catch (error) {
      logDebug('appEvents.listenerFailed', {
        error: error instanceof Error ? error.message : String(error),
        event,
      })
    }
  }
}

/** Test seam. Never called by the app. */
export function clearAppEventListeners(): void {
  listeners.action.clear()
  listeners.effect.clear()
}
