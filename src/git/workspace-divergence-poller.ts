import { useEffect } from 'react'

import type { BranchDivergence } from '../state/types'

import { appStore } from '../state/app-store'
import { dispatchGlobal } from '../state/dispatch-ref'
import { getBranchDivergence, getWorkspaceDiffStat } from './divergence'

const INTERVAL_MS = 4000
const MAX_INTERVAL_MS = 30_000

// Measuring one workspace costs three `git` spawns, and `diff --shortstat`
// alone re-stats its whole worktree — ~63ms on a large repo, against ~10ms for
// the other two. Re-running that every four seconds for every workspace of
// every project is what the machine spends its idle battery on, and almost
// every tick reads back exactly what the last one did.
//
// So each workspace carries its own due date: measured, it doubles its wait up
// to 30s while the numbers hold still, and drops back to 4s the moment they
// move. A workspace an agent is actively editing stays live; the thirty others
// sitting untouched go quiet. Only the first change after a long idle waits.
export const nextDelay = (previous: number, changed: boolean): number =>
  changed ? INTERVAL_MS : Math.min(previous * 2, MAX_INTERVAL_MS)

export const sameEntry = (a: BranchDivergence | undefined, b: BranchDivergence): boolean =>
  a != null &&
  a.ahead === b.ahead &&
  a.behind === b.behind &&
  a.added === b.added &&
  a.removed === b.removed

/**
 * Polls per-workspace base divergence for the current project while enabled and
 * dispatches it into workspaceDivergence. aimux-created workspaces are measured
 * against the ref they forked from; the primary and externally-discovered ones
 * never forked, so they fall back to their own upstream — for a root checkout on
 * main that reads as "unpushed commits + dirty work". A branch with no upstream
 * makes git fail, which the poller already renders as nothing.
 *
 * Runs once when enabled; reads projects from the store on each tick so project
 * updates do NOT re-create the effect. Taking `projects` as a dependency meant
 * every workspace switch tore the loop down and fired a fresh tick — holding
 * `j` in the sidebar launched a full git fan-out per keypress (~200ms of
 * subprocesses each) and the machine spent the whole time spawning `git`.
 */
export function useWorkspaceDivergencePolling(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    // Last reading per workspace, and when it is worth taking another one.
    // Skipped workspaces are re-dispatched from here: each dispatch replaces the
    // whole map, so dropping them would blank rows a previous tick filled.
    const measured = new Map<string, { entry: BranchDivergence; dueAt: number; delay: number }>()

    const tick = async () => {
      const now = Date.now()
      const targets = appStore
        .getState()
        .projects.flatMap((project) => project.workspaces ?? [])
        .filter((w) => w.branch != null && w.branch !== '')

      const due = targets.filter((w) => (measured.get(w.id)?.dueAt ?? 0) <= now)

      await Promise.all(
        due.map(async (workspace) => {
          const branch = workspace.branch
          if (branch == null) return
          // `<branch>@{upstream}` rather than a bare `@{upstream}`: the latter
          // resolves against the repo root's HEAD, which is not this workspace.
          const base =
            workspace.baseRef != null && workspace.baseRef !== ''
              ? workspace.baseRef
              : `${branch}@{upstream}`
          // Commits come from the repo root (comparing two refs); lines come
          // from the workspace itself, so uncommitted work is counted too.
          const [divergence, stat] = await Promise.all([
            getBranchDivergence(workspace.repoRoot, base, branch),
            getWorkspaceDiffStat(workspace.path, base),
          ])
          if (cancelled || divergence == null) return
          const entry = { ...divergence, ...stat }
          const previous = measured.get(workspace.id)
          const changed = !sameEntry(previous?.entry, entry)
          const delay = nextDelay(previous?.delay ?? INTERVAL_MS, changed)
          measured.set(workspace.id, { delay, dueAt: Date.now() + delay, entry })
        })
      )
      if (cancelled) return

      // Only when there was something to measure: an empty dispatch on a tick
      // that found no branches would blank rows the previous tick filled.
      if (targets.length > 0) {
        const next: Record<string, BranchDivergence> = {}
        for (const workspace of targets) {
          const entry = measured.get(workspace.id)?.entry
          if (entry != null) next[workspace.id] = entry
        }
        dispatchGlobal({ divergence: next, type: 'set-workspace-divergence' })
      }
      timer = setTimeout(() => void tick(), INTERVAL_MS)
    }

    void tick()

    return () => {
      cancelled = true
      if (timer != null) clearTimeout(timer)
    }
  }, [enabled])
}
