import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

/**
 * Workspace deletes in flight, keyed by workspace id, valued by the label to
 * show for them. Its own store rather than a slice of `AppState`: nothing here
 * survives the operation, no reducer decides anything about it, and the side
 * effect that owns the git work can set it without a dispatch round-trip.
 */
interface WorkspaceDeleteState {
  deleting: Record<string, string>
}

const workspaceDeleteStore = createStore<WorkspaceDeleteState>(() => ({ deleting: {} }))

export function beginWorkspaceDelete(workspaceId: string, label: string): void {
  workspaceDeleteStore.setState((state) => ({
    deleting: { ...state.deleting, [workspaceId]: label },
  }))
}

export function endWorkspaceDelete(workspaceId: string): void {
  workspaceDeleteStore.setState((state) => {
    const deleting = { ...state.deleting }
    delete deleting[workspaceId]
    return { deleting }
  })
}

export function useWorkspaceDeleteStore<T>(selector: (state: WorkspaceDeleteState) => T): T {
  return useStore(workspaceDeleteStore, selector)
}
