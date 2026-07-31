import { useEffect } from 'react'

import type { BranchDivergence } from '../state/types'

import { useAppStore } from '../state/app-store'
import { dispatchGlobal } from '../state/dispatch-ref'
import { getBranchDivergence } from './divergence'

const INTERVAL_MS = 4000

// Polls per-worktree base divergence for the current project while enabled and
// dispatches it into worktreeDivergence. Only worktrees that record a baseRef
// (the aimux-created ones) are measured; the primary and externally-discovered
// worktrees have no recorded base and are left out.
export function useWorktreeDivergencePolling(enabled: boolean): void {
  const currentProjectId = useAppStore((s) => s.currentProjectId)
  const projects = useAppStore((s) => s.projects)

  useEffect(() => {
    if (!enabled) return
    const project =
      currentProjectId != null && currentProjectId !== ''
        ? projects.find((s) => s.id === currentProjectId)
        : undefined
    const targets = (project?.worktrees ?? []).filter(
      (w) => w.baseRef != null && w.baseRef !== '' && w.branch != null && w.branch !== ''
    )
    if (targets.length === 0) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const tick = async () => {
      const entries = await Promise.all(
        targets.map(async (worktree) => {
          const base = worktree.baseRef
          const branch = worktree.branch
          if (base == null || branch == null) return null
          const divergence = await getBranchDivergence(worktree.repoRoot, base, branch)
          return divergence != null ? ([worktree.id, divergence] as const) : null
        })
      )
      if (cancelled) return
      const next: Record<string, BranchDivergence> = {}
      for (const entry of entries) {
        if (entry != null) next[entry[0]] = entry[1]
      }
      dispatchGlobal({ divergence: next, type: 'set-worktree-divergence' })
      timer = setTimeout(() => void tick(), INTERVAL_MS)
    }

    void tick()

    return () => {
      cancelled = true
      if (timer != null) clearTimeout(timer)
    }
  }, [enabled, currentProjectId, projects])
}
