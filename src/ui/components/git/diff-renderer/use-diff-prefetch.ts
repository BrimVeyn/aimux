import { useEffect, useRef } from 'react'

import {
  buildPrefetchTasks,
  MAX_PREFETCH_CONCURRENCY,
  PrefetchQueue,
  type PrefetchTask,
  runPrefetchTask,
} from '../../../../git/diff-prefetch-queue'
import { useAppStore } from '../../../../state/app-store'

// Re-export so existing call sites (`src/git/diff-orchestration.ts`) keep
// working without each module having to learn about the new shared file.
export { fetchAndPrepareDiff } from '../../../../git/diff-prefetch-queue'

interface PrefetchOptions {
  compareRef?: string
  enabled: boolean
  headOffset: number
  projectPath: string | undefined
  themeId: string
}

// Prefetches ±radius neighbours around the selected file so j/k-style navigation
// hits the cache. Runs through the full pipeline (git → parse → tokenize) off
// the main thread, bounded to MAX_PREFETCH_CONCURRENCY to stay below a crowd of
// git subprocesses. Cancels tasks that leave the window on each selection change.
//
// The queue management and task planning live in `diff-prefetch-queue.ts`
// (a headless module) so the GUI host can run the same algorithm without a
// React root via `startDiffPrefetchDriver`.
export function useDiffPrefetch(
  selectedEntryKey: string | null,
  radius: number,
  opts: PrefetchOptions
): void {
  const files = useAppStore((s) => s.gitPanel.files)
  const diffs = useAppStore((s) => s.gitMode.diffs)
  const parsed = useAppStore((s) => s.gitMode.parsedFiles)
  const loading = useAppStore((s) => s.gitMode.loading)
  const collapsedFolders = useAppStore((s) => s.gitMode.collapsedFolders)
  const fileListMode = useAppStore((s) => s.gitPane.fileListMode)
  const treeCompaction = useAppStore((s) => s.gitPane.treeCompaction)

  const queueRef = useRef<PrefetchQueue | null>(null)

  const { compareRef, enabled, headOffset, projectPath } = opts
  const runTaskRef = useRef<(task: PrefetchTask) => Promise<void>>(async () => {})

  // Keep a ref to the execute function so the queue keeps the latest closure
  // without needing to recreate the queue itself.
  runTaskRef.current = async (task: PrefetchTask) => {
    if (!(projectPath != null && projectPath !== '')) return
    await runPrefetchTask({ compareRef, headOffset, projectPath, task })
  }

  if (!queueRef.current) {
    queueRef.current = new PrefetchQueue(
      async (task) => runTaskRef.current(task),
      MAX_PREFETCH_CONCURRENCY
    )
  }

  useEffect(() => {
    const queue = queueRef.current
    if (!queue) return
    if (
      !enabled ||
      radius <= 0 ||
      projectPath == null ||
      projectPath === '' ||
      !(selectedEntryKey != null && selectedEntryKey !== '')
    ) {
      queue.cancelAll()
      return
    }
    const tasks = buildPrefetchTasks({
      collapsedFolders,
      diffs,
      fileListMode,
      files,
      loading,
      parsed,
      radius,
      selectedEntryKey,
      treeCompaction,
    })
    queue.schedule(tasks)
  }, [
    enabled,
    radius,
    projectPath,
    selectedEntryKey,
    files,
    collapsedFolders,
    fileListMode,
    treeCompaction,
    diffs,
    parsed,
    loading,
    headOffset,
    compareRef,
  ])

  useEffect(() => {
    return () => {
      queueRef.current?.cancelAll()
    }
  }, [])
}
