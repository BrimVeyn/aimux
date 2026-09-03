import type {
  ProjectStatus,
  QuestionKind,
  TabActivity,
  TabSession,
  WorkspaceRecord,
} from '../state/types'

import { logDebug } from '../debug/input-log'

/**
 * The daemon's event bus, and the vocabulary a daemon-half plugin subscribes
 * to with `ctx.on(...)`.
 *
 * Every one of these already existed as an IPC broadcast: the daemon knows a
 * tab finished a turn, or that a project was created, precisely because it is
 * about to tell the UI. Emitting locally first costs one function call and
 * makes the same knowledge available in-process — which is the whole of what a
 * "react to what agents are doing" plugin needs.
 *
 * Fired *before* the IPC send, deliberately. A plugin that reacts to a turn
 * ending should not be behind a socket write, and the ordering is one less
 * thing to reason about when a plugin and a UI disagree about what happened.
 */

export interface DaemonEvents {
  /** A tab's activity changed. The finest-grained signal, and the noisiest. */
  'tab:status': {
    tabId: string
    projectId: string
    status: TabActivity
    workspaceId?: string
  }
  /**
   * A tab's turn ended: `idle` held for the settle window. Edge-triggered,
   * once per turn — the honest "the agent has finished", unlike a raw `idle`
   * which flickers between tool calls.
   */
  'tab:turnComplete': { tabId: string; projectId: string; idleMs: number; workspaceId?: string }
  /** A tab is blocked on a question or a permission prompt. */
  'tab:question': {
    tabId: string
    projectId: string
    kind: QuestionKind
    prompt: string
    options?: string[]
  }
  /**
   * The user submitted a prompt to an agent.
   *
   * `source` says how it was learned: `hook` is ground truth from a provider
   * (Claude's `UserPromptSubmit`), `keystrokes` is reconstructed from the bytes
   * written to the PTY, which is the fallback for assistants with no hook. A
   * reconstruction the observer could not trust — history recall, tab
   * completion, unknown escapes — is dropped rather than reported wrong, so a
   * missing event is possible and a wrong one should not be.
   */
  'tab:prompt': {
    tabId: string
    projectId: string
    prompt: string
    source: 'hook' | 'keystrokes'
  }
  /** A tab was created, by the UI or by a headless CLI. */
  'tab:added': { projectId: string; tab: TabSession }
  /**
   * A tab's title changed — by the user, by aimux, or by a plugin. A plugin
   * that names tabs stops watching one on this: an in-flight generation that
   * lands after the user has typed their own title would overwrite it.
   */
  'tab:renamed': { tabId: string; projectId: string; title: string }
  /**
   * The tab is gone: closed, its process exited, or its project was closed
   * under it. Anything holding per-tab state drops it here.
   */
  'tab:closed': { tabId: string; projectId: string }
  /** A project's aggregate status changed. */
  'project:status': { projectId: string; status: ProjectStatus }
  'project:created': { name: string; projectPath?: string }
  'project:switched': { projectId: string }
  'project:closed': { projectId: string }
  'workspace:added': { projectId: string; workspace: WorkspaceRecord }
  'workspace:removed': { projectId: string; workspaceId: string }
  /**
   * The daemon is about to hand its socket to a successor binary. A plugin
   * that holds external state gets one chance to flush it; the process exits
   * a few hundred milliseconds later.
   */
  'daemon:reexec': { reason?: string }
}

export type DaemonEventName = keyof DaemonEvents

type Listener<K extends DaemonEventName> = (payload: DaemonEvents[K]) => void

const listeners = new Map<DaemonEventName, Set<Listener<DaemonEventName>>>()

export function onDaemonEvent<K extends DaemonEventName>(
  event: K,
  listener: Listener<K>
): () => void {
  let set = listeners.get(event)
  if (!set) {
    set = new Set()
    listeners.set(event, set)
  }
  const cast = listener as Listener<DaemonEventName>
  set.add(cast)
  return () => {
    set?.delete(cast)
  }
}

/**
 * Fires an event. A throwing subscriber is contained: this runs inside the
 * status-detection loop and inside the socket request handlers, and a plugin
 * listener must not be able to stop a broadcast the UI is waiting for.
 */
export function emitDaemonEvent<K extends DaemonEventName>(
  event: K,
  payload: DaemonEvents[K]
): void {
  const set = listeners.get(event)
  if (!set || set.size === 0) return
  // Snapshot: a listener that unsubscribes on its first call must not shift
  // the set under the loop.
  const current = [...set] as Listener<K>[]
  for (const listener of current) {
    try {
      listener(payload)
    } catch (error) {
      logDebug('daemonEvents.listenerFailed', {
        error: error instanceof Error ? error.message : String(error),
        event,
      })
    }
  }
}

/** Test seam. Never called by the app. */
export function clearDaemonEventListeners(): void {
  listeners.clear()
}
