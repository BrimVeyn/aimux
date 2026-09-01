import type { AppState, ProjectRecord, SnippetRecord } from '../state/types'

// eslint-disable-next-line no-duplicate-imports
import { type AssistantOption, getAssistantOption } from '../pty/command-registry'
import { filterProjects, filterSnippets, getNewTabAssistantOptions } from '../state/selectors'

/**
 * The row a picker modal currently highlights. Each reads the same filtered
 * list the modal renders, so the effect acts on the row the user is looking at.
 */
export function getSelectedProject(state: AppState): ProjectRecord | undefined {
  const filter = state.modal.type === 'project-picker' ? state.modal.editBuffer : null
  return filterProjects(state.projects, filter)[state.modal.selectedIndex]
}

export function getSelectedSnippet(state: AppState): SnippetRecord | undefined {
  const filter = state.modal.type === 'snippet-picker' ? state.modal.editBuffer : null
  return filterSnippets(state.snippets, filter)[state.modal.selectedIndex]
}

export function getSelectedAssistantOption(state: AppState): AssistantOption {
  const newTab = state.modal.type === 'new-tab' ? state.modal : null
  const list = getNewTabAssistantOptions(
    state.customCommands,
    newTab?.editBuffer ?? null,
    newTab?.pendingWorkspace != null
  )
  return list[state.modal.selectedIndex] ?? list[0] ?? getAssistantOption(0)
}
