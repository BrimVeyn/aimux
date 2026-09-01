import type { AppAction } from '../state/actions'
import type { ModalState } from '../state/types'

import { searchProjectDirectories, warmDirectoryCache } from '../platform/project-search'

const DEBOUNCE_MS = 200

function directoryQuery(modal: ModalState): string | null {
  if (modal.type !== 'create-project') {
    return null
  }
  if (modal.activeField === 'directory') {
    return modal.editBuffer ?? ''
  }
  return modal.nameBuffer
}

/**
 * Store-driven port of `use-directory-search`: call `onModal(modal)` from the
 * host's appStore.subscribe whenever state changes. Debounces queries and
 * dispatches `set-directory-results`. No React.
 */
export function createDirectorySearchRunner(dispatch: (action: AppAction) => void): {
  onModal: (modal: ModalState) => void
} {
  let lastQuery: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let requestId = 0
  let warmed = false

  const onModal = (modal: ModalState): void => {
    const query = directoryQuery(modal)

    if (query === null) {
      // Modal closed/changed — reset so reopening re-searches.
      lastQuery = null
      warmed = false
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      return
    }

    if (!warmed) {
      warmed = true
      void warmDirectoryCache()
    }

    if (query === lastQuery) {
      return
    }
    lastQuery = query

    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }

    if (query.trim() === '') {
      dispatch({ results: [], type: 'set-directory-results' })
      return
    }

    const id = ++requestId
    timer = setTimeout(() => {
      void (async () => {
        const results = await searchProjectDirectories(query)
        if (id === requestId) {
          dispatch({ results, type: 'set-directory-results' })
        }
      })()
    }, DEBOUNCE_MS)
  }

  return { onModal }
}
