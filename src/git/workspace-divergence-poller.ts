import { useEffect } from 'react'

import type { BranchDivergence } from '../state/types'

import { useAppStore } from '../state/app-store'
import { dispatchGlobal } from '../state/dispatch-ref'
import { getBranchDivergence, getWorkspaceDiffStat } from './divergence'

const INTERVAL_MS = 4000

// Polls per-workspace base divergence for the current project while enabled and
// dispatches it into workspaceDivergence. Only workspaces that record a baseRef
// (the aimux-created ones) are measured; the primary and externally-discovered
// workspaces have no recorded base and are left out.
export function useWorkspaceDivergencePolling(enabled: boolean): void {
  const currentProjectId = useAppStore((s) => s.currentProjectId)
  const projects = useAppStore((s) => s.projects)

  useEffect(() => {
    if (!enabled) return
    const project =
      currentProjectId != null && currentProjectId !== ''
        ? projects.find((s) => s.id === currentProjectId)
        : undefined
    const targets = (project?.workspaces ?? []).filter(
      (w) => w.baseRef != null && w.baseRef !== '' && w.branch != null && w.branch !== ''
    )
    if (targets.length === 0) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const tick = async () => {
      const entries = await Promise.all(
        targets.map(async (workspace) => {
          const base = workspace.baseRef
          const branch = workspace.branch
          if (base == null || branch == null) return null
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
  }, [enabled, currentProjectId, projects])
}
