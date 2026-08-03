import { useEffect } from 'react'

import type { BranchDivergence } from '../state/types'

import { useAppStore } from '../state/app-store'
import { dispatchGlobal } from '../state/dispatch-ref'
import { getBranchDivergence, getWorkspaceDiffStat } from './divergence'

const INTERVAL_MS = 4000

// Polls per-workspace base divergence for the current project while enabled and
// dispatches it into workspaceDivergence. aimux-created workspaces are measured
// against the ref they forked from; the primary and externally-discovered ones
// never forked, so they fall back to their own upstream — for a root checkout on
// main that reads as "unpushed commits + dirty work". A branch with no upstream
// makes git fail, which the poller already renders as nothing.
export function useWorkspaceDivergencePolling(enabled: boolean): void {
  const projects = useAppStore((s) => s.projects)

  useEffect(() => {
    if (!enabled) return
    // Every project, not just the current one: each dispatch replaces the whole
    // map, so polling one project's workspaces blanks the stats of every other
    // project's rows — which the sidebar shows all of at once.
    // ponytail: one unbounded fan-out per tick, two `git` spawns per workspace.
    // Batch or stagger if a machine with many projects feels it.
    const targets = projects
      .flatMap((project) => project.workspaces ?? [])
      .filter((w) => w.branch != null && w.branch !== '')
    if (targets.length === 0) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const tick = async () => {
      const entries = await Promise.all(
        targets.map(async (workspace) => {
          const branch = workspace.branch
          if (branch == null) return null
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
          if (divergence == null) return null
          return [workspace.id, { ...divergence, ...stat }] as const
        })
      )
      if (cancelled) return
      const next: Record<string, BranchDivergence> = {}
      for (const entry of entries) {
        if (entry != null) next[entry[0]] = entry[1]
      }
      dispatchGlobal({ divergence: next, type: 'set-workspace-divergence' })
      timer = setTimeout(() => void tick(), INTERVAL_MS)
    }

    void tick()

    return () => {
      cancelled = true
      if (timer != null) clearTimeout(timer)
    }
  }, [enabled, projects])
}
