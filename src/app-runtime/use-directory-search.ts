import { useEffect } from 'react'

import type { AppAction, ModalState } from '../state/types'

import { searchProjectDirectories } from '../platform/project-search'

export function useDirectorySearch(
  modal: ModalState,
  dispatch: (action: AppAction) => void,
  debounceMs = 200
): void {
  const directoryQuery =
    modal.type === 'create-session'
      ? modal.activeField === 'directory'
        ? (modal.editBuffer ?? '')
        : modal.nameBuffer
      : ''

  useEffect(() => {
    if (modal.type !== 'create-session') {
      return
    }

    if (!directoryQuery.trim()) {
      dispatch({ type: 'set-directory-results', results: [] })
      return
    }

    const timer = setTimeout(async () => {
      const results = await searchProjectDirectories(directoryQuery)
      dispatch({ type: 'set-directory-results', results })
    }, debounceMs)

    return () => clearTimeout(timer)
  }, [debounceMs, directoryQuery, dispatch, modal.type])
}
