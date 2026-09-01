import type { DiffData, GitFileEntry } from '../state/types'

import { appStore } from '../state/app-store'
import { dispatchGlobal } from '../state/dispatch-ref'
import { fetchAndPrepareDiff } from '../ui/components/git/diff-renderer/use-diff-prefetch'

export interface DiffOnDemandOpts {
  enabled: boolean
  getCachedDiff: (key: string) => DiffData | undefined
  getCompareRef: () => string | undefined
  getHeadOffset: () => number
  getProjectPath: () => string | undefined
  getSelectedFile: () => GitFileEntry | null
  getSelectedKey: () => string | null
}

/**
 * Headless on-demand diff fetcher for the GUI host. Subscribes to the app
 * store and, on each change of `gitMode.selectedEntryKey` (or session
 * identity), kicks off a single `fetchAndPrepareDiff` for the selected file.
 *
 * v1 scope: fetch only the currently selected file (no neighbour prefetch).
 * The React `useDiffPrefetch` hook still owns the radius prefetch when the
 * TUI is mounted; the GUI host runs this minimal variant so the projection's
 * `gitMode.diffs[key]` populates as the user navigates the panel.
 *
 * Returns a disposer that aborts any in-flight controller and unsubscribes.
 */
export function startDiffOnDemandPipeline(opts: DiffOnDemandOpts): () => void {
  let currentController: AbortController | null = null
  let lastFetchedKey: string | null = null

  const tryFetch = (): void => {
    if (!opts.enabled) return
    const key = opts.getSelectedKey()
    if (key == null || key === '') return
    const projectPath = opts.getProjectPath()
    if (projectPath == null || projectPath === '') return
    const file = opts.getSelectedFile()
    if (!file) return
    // Cache hit — nothing to do.
    if (opts.getCachedDiff(key)) return
    // Already kicked one off for this key; let it finish.
    if (lastFetchedKey === key && currentController !== null) return

    // New selection — cancel any in-flight fetch for the previous one.
    currentController?.abort()
    const controller = new AbortController()
    currentController = controller
    lastFetchedKey = key
    const headOffset = opts.getHeadOffset()
    const compareRef = opts.getCompareRef()

    dispatchGlobal({ key, loading: true, type: 'git-mode-set-loading' })

    void (async () => {
      try {
        const { diff, hash, prepared } = await fetchAndPrepareDiff({
          compareRef,
          file,
          headOffset,
          projectPath,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        dispatchGlobal({ diff, hash, key, type: 'git-mode-set-diff' })
        dispatchGlobal({
          file: prepared.parsed,
          hash: prepared.hash,
          key,
          type: 'git-mode-set-parsed',
        })
      } catch {
        // Fetch errors surface via `DiffData.errorMessage` from `fetchDiff`
        // when possible. Aborts and other failures: just clear loading and
        // let the next selection re-trigger.
        if (!controller.signal.aborted) {
          dispatchGlobal({ key, loading: false, type: 'git-mode-set-loading' })
        }
      } finally {
        if (currentController === controller) {
          currentController = null
        }
      }
    })()
  }

  let prevSelectedKey = appStore.getState().gitMode.selectedEntryKey
  let prevProjectId = appStore.getState().currentProjectId

  const unsubscribe = appStore.subscribe(() => {
    const state = appStore.getState()
    const nextKey = state.gitMode.selectedEntryKey
    const nextProjectId = state.currentProjectId
    const projectChanged = nextProjectId !== prevProjectId
    if (nextKey !== prevSelectedKey || projectChanged) {
      prevSelectedKey = nextKey
      prevProjectId = nextProjectId
      // Drop the dedup latch so a re-selection of the same key after a
      // session change re-fetches against the new project path.
      if (projectChanged) {
        lastFetchedKey = null
      }
      tryFetch()
    }
  })

  // Initial fetch in case a selection already exists at startup.
  tryFetch()

  return () => {
    unsubscribe()
    currentController?.abort()
    currentController = null
  }
}
