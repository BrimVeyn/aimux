/**
 * Per-workspace activity, and the notification sound that goes with it.
 *
 * The store only holds tabs for the project the client is attached to, but the
 * daemon broadcasts every tab's status with its `workspaceId` (v18). So the
 * table of "which tab is doing what" lives here, module-owned, and only the
 * aggregate per workspace is dispatched into `AppState.workspaceActivity` —
 * which is what the sidebar draws for every project, current or not.
 *
 * Both notification sounds are triggered from here so the glyph and the sound
 * can never disagree about what happened:
 *   - a tab entering `waiting-input` (the agent is asking something),
 *   - a tab completing a turn (the daemon's settled end-of-turn signal).
 * Neither fires for the tab you are looking at.
 */
import type { TabActivity } from '../state/types'

import { playNotificationSound } from '../settings/sections/notifications'
import { appStore } from '../state/app-store'
import { dispatchGlobal } from '../state/dispatch-ref'

interface Entry {
  status: TabActivity
  workspaceId: string | undefined
}

// ponytail: a tab in another project never sends this client its `tabExit`, so
// an entry here can outlive its PTY. Harmless — a dead tab's last status is
// `idle`, which contributes nothing to the aggregate, and the `done` latch is
// cleared the next time the workspace is entered. Revisit if the daemon ever
// broadcasts tab removal to every client.
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
  workspaceId: string | undefined
): void {
  const previous = entries.get(tabId)
  entries.set(tabId, { status, workspaceId })
  // A tab can be reassigned to another workspace (workspace move); the one it
  // left has one tab fewer and has to be recomputed too.
  if (previous && previous.workspaceId !== workspaceId) publish(previous.workspaceId)
  publish(workspaceId)

  if (
    status === 'waiting-input' &&
    previous?.status !== 'waiting-input' &&
    !isBeingWatched(tabId)
  ) {
    playNotificationSound()
  }
}

export function recordTurnComplete(tabId: string, workspaceId: string | undefined): void {
  if (isBeingWatched(tabId)) return
  if (workspaceId != null && workspaceId !== '') {
    dispatchGlobal({ type: 'mark-workspace-done', workspaceId })
  }
  playNotificationSound()
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
