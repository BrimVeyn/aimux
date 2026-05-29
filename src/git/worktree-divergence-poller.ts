import { useEffect } from 'react'

import type { BranchDivergence, SessionRecord } from '../state/types'

import { useAppStore } from '../state/app-store'
import { dispatchGlobal } from '../state/dispatch-ref'
import { getBranchDivergence } from './divergence'

const INTERVAL_MS = 4000

interface StartOptions {
  enabled: boolean
  // Snapshot getters — called at the start of every tick so session/worktree
  // changes are picked up without restarting the loop.
  getCurrentSessionId: () => string | null
  getSessions: () => SessionRecord[]
}

/**
 * Headless worktree-divergence poller. Returns a disposer. Used by
 * `useWorktreeDivergencePolling` (React) and the GUI host (no React root).
 * Same observable behavior as the previous useEffect body.
 */
export function startWorktreeDivergencePolling({
  enabled,
  getCurrentSessionId,
  getSessions,
}: StartOptions): () => void {
  if (!enabled) return () => {}

  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const tick = async () => {
    const currentSessionId = getCurrentSessionId()
    const sessions = getSessions()
    const session =
      currentSessionId != null && currentSessionId !== ''
        ? sessions.find((s) => s.id === currentSessionId)
        : undefined
    const targets = (session?.worktrees ?? []).filter(
      (w) => w.baseRef != null && w.baseRef !== '' && w.branch != null && w.branch !== ''
    )
    if (targets.length === 0) {
      if (cancelled) return
      timer = setTimeout(() => void tick(), INTERVAL_MS)
      return
    }

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
}

// Polls per-worktree base divergence for the current session while enabled and
// dispatches it into worktreeDivergence. Only worktrees that record a baseRef
// (the aimux-created ones) are measured; the primary and externally-discovered
// worktrees have no recorded base and are left out.
export function useWorktreeDivergencePolling(enabled: boolean): void {
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const sessions = useAppStore((s) => s.sessions)

  useEffect(() => {
    return startWorktreeDivergencePolling({
      enabled,
      getCurrentSessionId: () => currentSessionId,
      getSessions: () => sessions,
    })
  }, [enabled, currentSessionId, sessions])
}
