import { useEffect } from 'react'

import type { BranchDivergence } from '../state/types'

import { useAppStore } from '../state/app-store'
import { dispatchGlobal } from '../state/dispatch-ref'
import { getBranchDivergence } from './divergence'

const INTERVAL_MS = 4000

// Polls per-worktree base divergence for the current session while enabled and
// dispatches it into worktreeDivergence. Only worktrees that record a baseRef
// (the aimux-created ones) are measured; the primary and externally-discovered
// worktrees have no recorded base and are left out.
export function useWorktreeDivergencePolling(enabled: boolean): void {
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const sessions = useAppStore((s) => s.sessions)

  useEffect(() => {
    if (!enabled) return
    const session =
      currentSessionId != null && currentSessionId !== ''
        ? sessions.find((s) => s.id === currentSessionId)
        : undefined
    const targets = (session?.worktrees ?? []).filter(
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
  }, [enabled, currentSessionId, sessions])
}
