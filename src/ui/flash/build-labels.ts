import type { AppState, FlashJumpTarget, FlashLabel } from '../../state/types'

import { filterTabsForActiveWorktree } from '../../state/session-worktrees'
import { orderSessionsForDisplay } from '../session-ordering'
import { assignFlashLabels, type FlashTarget } from './assign-labels'

interface PendingTarget {
  key: string
  name: string
  target: FlashJumpTarget
}

/**
 * Collect every visible flash-jump target in the same order the UI renders:
 * workspace rows first (each followed by its non-primary worktrees), then the
 * tabs of the active worktree. Stable ordering keeps the assigned labels
 * predictable across re-opens when nothing changed.
 */
function collectTargets(state: AppState): PendingTarget[] {
  const out: PendingTarget[] = []
  const ordered = orderSessionsForDisplay(state.sessions)
  for (const [index, session] of ordered.entries()) {
    const sessionIndex = index + 1
    const worktrees = session.worktrees ?? []
    const primary = worktrees.find((w) => w.source === 'primary') ?? worktrees[0]
    out.push({
      key: `ws:${session.id}`,
      name: session.name,
      target: {
        kind: 'workspace',
        sessionId: session.id,
        sessionIndex,
        worktreeId: primary?.id,
      },
    })
    for (const worktree of worktrees) {
      if (worktree.id === primary?.id) continue
      out.push({
        key: `wt:${worktree.id}`,
        name: worktree.name,
        target: {
          kind: 'worktree',
          sessionId: session.id,
          sessionIndex,
          worktreeId: worktree.id,
        },
      })
    }
  }

  const currentSession = state.sessions.find((s) => s.id === state.currentSessionId)
  if (currentSession) {
    const tabs = filterTabsForActiveWorktree(state.tabs, currentSession)
    for (const tab of tabs) {
      out.push({
        key: `tab:${tab.id}`,
        name: tab.title,
        target: { kind: 'tab', sessionId: currentSession.id, sessionIndex: 0, tabId: tab.id },
      })
    }
  }

  return out
}

export function buildFlashJumpLabels(state: AppState): FlashLabel[] {
  const pending = collectTargets(state)
  const flashTargets: FlashTarget[] = pending.map(({ key, name }) => ({ key, name }))
  const assigned = assignFlashLabels(flashTargets)
  const byKey = new Map(pending.map((entry) => [entry.key, entry.target]))
  const out: FlashLabel[] = []
  for (const { key, label } of assigned) {
    const target = byKey.get(key)
    if (!target) continue
    out.push({ key, label, target })
  }
  return out
}
