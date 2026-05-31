import { useEffect } from 'react'

import { appStore } from '../state/app-store'
import { dispatchGlobal } from '../state/dispatch-ref'
import { getCurrentBranch } from '../ui/git-branch'

const INTERVAL_MS = 4000

// Single source of truth for "what git branch is each worktree on right now".
// Polls every known worktree's path and dispatches update-worktree-record
// when the live branch differs from the stored one. Components read
// `worktree.branch` from state — no per-component polling, no flickers.
//
// Runs once when enabled; reads sessions from the store on each tick so
// session updates do NOT re-create the effect (which would otherwise feedback
// off our own dispatches).
export function useWorktreeBranchPolling(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const tick = async () => {
      const sessions = appStore.getState().sessions
      await Promise.all(
        sessions.flatMap((session) =>
          (session.worktrees ?? []).map(async (worktree) => {
            if (worktree.path == null || worktree.path === '') return
            const branch = await getCurrentBranch(worktree.path)
            if (cancelled) return
            if (branch != null && branch !== worktree.branch) {
              dispatchGlobal({
                patch: { branch },
                sessionId: session.id,
                type: 'update-worktree-record',
                worktreeId: worktree.id,
              })
            }
          })
        )
      )
      if (cancelled) return
      timer = setTimeout(() => void tick(), INTERVAL_MS)
    }

    void tick()

    return () => {
      cancelled = true
      if (timer != null) clearTimeout(timer)
    }
  }, [enabled])
}
