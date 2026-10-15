import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

/**
 * The steps of the `<C-p>` worktree being cut, and how many are finished, for
 * the new-tab picker's progress view. Empty until the git queue lets the create
 * start. Its own store for the same reason as the delete one: nothing here
 * outlives the operation and no reducer decides anything about it.
 */
interface WorkspaceCreateProgress {
  steps: string[]
  done: number
}

const workspaceCreateStore = createStore<WorkspaceCreateProgress>(() => ({ done: 0, steps: [] }))

export function planWorkspaceCreate(steps: string[]): void {
  workspaceCreateStore.setState({ done: 0, steps })
}

export function completeWorkspaceCreateStep(): void {
  workspaceCreateStore.setState((state) => ({ done: state.done + 1 }))
}

export function useWorkspaceCreateProgress(): WorkspaceCreateProgress {
  return useStore(workspaceCreateStore)
}
