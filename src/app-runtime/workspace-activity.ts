/**
 * Per-workspace activity, and the notification sound that goes with it.
 *
 * The store only holds tabs for the project the client is attached to, but the
 * daemon broadcasts every tab's status with its `workspaceId` (v18). So the
 * table of "which tab is doing what" lives here, module-owned, and only the
 * aggregate per workspace is dispatched into `AppState.workspaceActivity` —
 * which is what the sidebar draws for every project, current or not.
 *
 * Both notifications are raised from here so the glyph and the sound can
 * never disagree about what happened (a plugin sink may deliver them instead
 * of the sound; see `ui/notifications.ts`):
 *   - a tab entering `waiting-input` (the agent is asking something),
 *   - a tab completing a turn (the daemon's settled end-of-turn signal).
 * Neither fires for the tab you are looking at.
 */
import type { TabActivity } from '../state/types'

import { appStore } from '../state/app-store'
import { dispatchGlobal } from '../state/dispatch-ref'
import { notifyTurnComplete, notifyWaitingInput } from '../ui/notifications'

interface Entry {
  status: TabActivity
  workspaceId: string | undefined
  /**
   * Whether this client has seen the tab do something since the last turn it
   * announced. The daemon's end-of-turn timer is per-process: restart it (an
   * update, `restart-daemon`) and every surviving idle PTY produces a
   * turn-complete a settle window later. Requiring an observed `working` /
   * `waiting-input` first is what keeps that restart from ticking every
   * workspace and ringing.
   */
  armed: boolean
}

// A tab in another project never sends this client its `tabExit`, so an entry
// here can outlive its PTY. The daemon emits a final `idle` for a tab it stops
// seeing (the tick cleanup in `assistant-status-detection-loop.ts`), which is
// what keeps a tab that died mid-turn from pinning a spinner to a workspace
// row forever; the entry itself is left behind, contributing nothing.
const entries = new Map<string, Entry>()

/** The two flags a set of tabs adds up to. Pure, and the reason it is exported. */
export function aggregate(statuses: readonly TabActivity[]): {
  working: boolean
  waiting: boolean
} {
  return {
    waiting: statuses.includes('waiting-input'),
    working: statuses.includes('working'),
  }
}

function publish(workspaceId: string | undefined): void {
  if (workspaceId == null || workspaceId === '') return
  const statuses: TabActivity[] = []
  for (const entry of entries.values()) {
    if (entry.workspaceId === workspaceId) statuses.push(entry.status)
  }
  const { waiting, working } = aggregate(statuses)
  dispatchGlobal({ type: 'set-workspace-activity', waiting, working, workspaceId })
}

/** True when this tab is the one on screen — no sound, no unseen-tick, for it. */
function isBeingWatched(tabId: string): boolean {
  return appStore.getState().activeTabId === tabId
}

export function recordTabStatus(
  tabId: string,
  status: TabActivity,
  workspaceId: string | undefined,
  options?: { silent?: boolean }
): void {
  const previous = entries.get(tabId)
  const armed = status === 'working' || status === 'waiting-input' || (previous?.armed ?? false)
  // An event that carries no workspace does not mean the tab lost one. A tab
  // created before the daemon recorded workspaces has none in its registry,
  // but the client's own snapshot does — and the attach seeded us with it, so
  // keep it rather than blanking the row on the next status change.
  const known = workspaceId ?? previous?.workspaceId
  entries.set(tabId, { armed, status, workspaceId: known })
  // A tab can be reassigned to another workspace (workspace move); the one it
  // left has one tab fewer and has to be recomputed too.
  if (previous && previous.workspaceId !== known) publish(previous.workspaceId)
  publish(known)

  if (
    options?.silent !== true &&
    status === 'waiting-input' &&
    previous?.status !== 'waiting-input' &&
    !isBeingWatched(tabId)
  ) {
    notifyWaitingInput(tabId, known)
  }
}

/**
 * Seed from the tabs an attach handed us, so a workspace whose agent has been
 * waiting since before this client started says so on the first paint instead
 * of waiting for a transition that already happened. Silent by definition:
 * nothing here is news.
 */
export function seedTabActivity(
  tabs: readonly { id: string; activity?: TabActivity; workspaceId?: string }[]
): void {
  for (const tab of tabs) {
    recordTabStatus(tab.id, tab.activity ?? 'idle', tab.workspaceId, { silent: true })
  }
}

export function recordTurnComplete(tabId: string, workspaceId: string | undefined): void {
  const entry = entries.get(tabId)
  // Nothing observed since the last turn — this is a restarted daemon
  // re-announcing the end of a turn that ended before we were listening.
  if (entry?.armed !== true) return
  entry.armed = false
  if (isBeingWatched(tabId)) return
  if (workspaceId != null && workspaceId !== '') {
    dispatchGlobal({ type: 'mark-workspace-done', workspaceId })
  }
  // The workspace tick says where to look; this says which tab rang. A no-op
  // for a tab this client doesn't hold — its workspace row is the answer there.
  dispatchGlobal({ tabId, type: 'mark-tab-unseen' })
  notifyTurnComplete(tabId, workspaceId)
}

export function forgetTabActivity(tabId: string): void {
  const entry = entries.get(tabId)
  if (!entry) return
  entries.delete(tabId)
  publish(entry.workspaceId)
}

/** Test seam: drop every remembered tab. */
export function resetWorkspaceActivity(): void {
  entries.clear()
}
