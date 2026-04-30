import { useEffect } from 'react'

import type { AppAction, ModalState } from '../state/types'

import { searchRepoScriptFiles } from '../platform/script-search'

const DEFAULT_SCRIPT_SEARCH_DEBOUNCE_MS = 150

function getScriptQuery(modal: ModalState): string {
  if (modal.type === 'new-tab' && modal.step === 'worktree-create') {
    if (modal.activeField === 'setup-script') return modal.setupScript
    if (modal.activeField === 'sanitize-script') return modal.sanitizeScript
    return ''
  }
  if (modal.type !== 'worktree-scripts') return ''
  return modal.editBuffer ?? ''
}

export function useScriptFileSearch(
  modal: ModalState,
  projectPath: string | undefined,
  dispatch: (action: AppAction) => void,
  debounceMs = DEFAULT_SCRIPT_SEARCH_DEBOUNCE_MS
): void {
  const query = getScriptQuery(modal)
  const modalType = modal.type
  const activeField =
    modal.type === 'new-tab' || modal.type === 'worktree-scripts' ? modal.activeField : null
  const step = modal.type === 'new-tab' ? modal.step : null
  const resultCount =
    modal.type === 'new-tab' || modal.type === 'worktree-scripts' ? modal.scriptResults.length : 0

  useEffect(() => {
    if (
      modalType !== 'worktree-scripts' &&
      !(modalType === 'new-tab' && step === 'worktree-create')
    ) {
      return
    }
    let isCurrent = true
    const trimmed = query.trim()
    if (!trimmed) {
      if (resultCount > 0) dispatch({ results: [], type: 'set-script-file-results' })
      return
    }
    const timer = setTimeout(async () => {
      const results = await searchRepoScriptFiles(projectPath, trimmed)
      if (isCurrent) dispatch({ results, type: 'set-script-file-results' })
    }, debounceMs)
    return () => {
      isCurrent = false
      clearTimeout(timer)
    }
  }, [activeField, debounceMs, dispatch, modalType, projectPath, query, resultCount, step])
}
