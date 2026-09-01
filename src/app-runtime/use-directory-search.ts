import { useEffect } from 'react'

import type { AppAction } from '../state/actions'
import type { ModalState } from '../state/types'

import { searchProjectDirectories, warmDirectoryCache } from '../platform/project-search'

const DEFAULT_DIRECTORY_SEARCH_DEBOUNCE_MS = 200

function getDirectoryQuery(modal: ModalState): string {
  if (modal.type !== 'create-project') {
    return ''
  }

  if (modal.activeField === 'directory') {
    return modal.editBuffer ?? ''
  }

  return modal.nameBuffer
}

export function useDirectorySearch(
  modal: ModalState,
  dispatch: (action: AppAction) => void,
  debounceMs = DEFAULT_DIRECTORY_SEARCH_DEBOUNCE_MS
): void {
  const directoryQuery = getDirectoryQuery(modal)

  useEffect(() => {
    if (modal.type !== 'create-project') return
    void warmDirectoryCache()
  }, [modal.type])

  useEffect(() => {
    if (modal.type !== 'create-project') {
      return
    }

    let isCurrent = true

    if (!directoryQuery.trim()) {
      dispatch({ results: [], type: 'set-directory-results' })
      return
    }

    const timer = setTimeout(() => {
      void (async () => {
        const results = await searchProjectDirectories(directoryQuery)
        if (isCurrent) {
          dispatch({ results, type: 'set-directory-results' })
        }
      })()
    }, debounceMs)

    return () => {
      isCurrent = false
      clearTimeout(timer)
    }
  }, [debounceMs, directoryQuery, dispatch, modal.type])
}
