import { useEffect } from 'react'

import { appStore } from '../state/app-store'
import { dispatchGlobal } from '../state/dispatch-ref'
import { getCurrentBranch } from '../ui/git-branch'

const INTERVAL_MS = 4000

// Single source of truth for "what git branch is each workspace on right now".
// Polls every known workspace's path and dispatches update-workspace-record
// when the live branch differs from the stored one. Components read
// `workspace.branch` from state — no per-component polling, no flickers.
//
// Runs once when enabled; reads projects from the store on each tick so
// project updates do NOT re-create the effect (which would otherwise feedback
// off our own dispatches).
export function useWorkspaceBranchPolling(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return

    let timer: ReturnType<typeof setTimeout> | null = null

    const tick = () => {
      for (const project of appStore.getState().projects) {
        for (const workspace of project.workspaces ?? []) {
          if (workspace.path == null || workspace.path === '') continue
          const branch = getCurrentBranch(workspace.path)
          if (branch != null && branch !== workspace.branch) {
            dispatchGlobal({
              patch: { branch },
              projectId: project.id,
              type: 'update-workspace-record',
              workspaceId: workspace.id,
            })
          }
        }
      }
      timer = setTimeout(tick, INTERVAL_MS)
    }

    tick()

    return () => {
      if (timer != null) clearTimeout(timer)
    }
  }, [enabled])
}
