import type { DiffData, GitFileEntry, GitFileListMode, ParsedDiffEntry } from '../state/types'

import {
  buildPrefetchTasks,
  MAX_PREFETCH_CONCURRENCY,
  PrefetchQueue,
  runPrefetchTask,
} from '../git/diff-prefetch-queue'

export interface DiffPrefetchDriverOpts {
  getCollapsedFolders: () => Record<string, true>
  getCompareRef: () => string | undefined
  getDiffs: () => Record<string, DiffData | undefined>
  getEnabled: () => boolean
  getFileListMode: () => GitFileListMode
  getFiles: () => GitFileEntry[]
  getHeadOffset: () => number
  getLoading: () => Record<string, boolean | undefined>
  getParsed: () => Record<string, ParsedDiffEntry>
  getProjectPath: () => string | undefined
  getRadius: () => number
  getSelectedKey: () => string | null
  getTreeCompaction: () => boolean
}

export interface DiffPrefetchDriver {
  dispose: () => void
  /**
   * Recompute the prefetch window and reconcile the queue. Call this every
   * time the host detects a change to any input (selection, file list, radius,
   * cache contents, …). Cheap when nothing changed because the queue dedupes
   * by key and skips already-cached/inflight entries.
   */
  update: () => void
}

/**
 * Headless port of `useDiffPrefetch` for the GUI host. Drives the same
 * concurrency-bounded prefetch queue that the TUI's React hook owns, so
 * arrow-up/down through the git pane hits a warm cache instead of waiting
 * on a fresh `git diff` per keypress.
 *
 * The host owns the `appStore.subscribe` listener — call `update()` from
 * there whenever inputs change. The driver itself is decoupled from the
 * store (matches the pattern of `startMultiRepoDiscoveryDriver`).
 */
export function startDiffPrefetchDriver(opts: DiffPrefetchDriverOpts): DiffPrefetchDriver {
  const queue = new PrefetchQueue(async (task) => {
    const projectPath = opts.getProjectPath()
    if (projectPath == null || projectPath === '') return
    const compareRef = opts.getCompareRef()
    const headOffset = opts.getHeadOffset()
    await runPrefetchTask({ compareRef, headOffset, projectPath, task })
  }, MAX_PREFETCH_CONCURRENCY)

  const update = (): void => {
    const enabled = opts.getEnabled()
    const radius = opts.getRadius()
    const projectPath = opts.getProjectPath()
    const selectedEntryKey = opts.getSelectedKey()
    if (
      !enabled ||
      radius <= 0 ||
      projectPath == null ||
      projectPath === '' ||
      selectedEntryKey == null ||
      selectedEntryKey === ''
    ) {
      queue.cancelAll()
      return
    }
    const tasks = buildPrefetchTasks({
      collapsedFolders: opts.getCollapsedFolders(),
      diffs: opts.getDiffs(),
      fileListMode: opts.getFileListMode(),
      files: opts.getFiles(),
      loading: opts.getLoading(),
      parsed: opts.getParsed(),
      radius,
      selectedEntryKey,
      treeCompaction: opts.getTreeCompaction(),
    })
    queue.schedule(tasks)
  }

  return {
    dispose() {
      queue.cancelAll()
    },
    update,
  }
}
