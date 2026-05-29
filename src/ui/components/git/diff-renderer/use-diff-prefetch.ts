import { useEffect, useRef } from 'react'

import type { DiffData, GitFileEntry } from '../../../../state/types'

import { diffHash } from '../../../../git/diff-hash'
import { fetchDiff } from '../../../../git/git-diff'
import { useAppStore } from '../../../../state/app-store'
import { dispatchGlobal } from '../../../../state/dispatch-ref'
import { buildGitTreeRows } from '../../../../state/git-tree'
import { type PreparedDiff, prepareDiff } from './prepare-diff'

interface PrefetchOptions {
  compareRef?: string
  enabled: boolean
  headOffset: number
  projectPath: string | undefined
  themeId: string
}

const MAX_CONCURRENCY = 3

interface Task {
  controller: AbortController
  distance: number
  file: GitFileEntry
  key: string
}

interface FetchAndPrepareOpts {
  compareRef?: string
  file: GitFileEntry
  headOffset: number
  projectPath: string
  signal?: AbortSignal
}

/**
 * Pure async pipeline: fetch the diff for one file then run `prepareDiff`.
 *
 * Returns both the raw `DiffData` (with `hash` already computed via the
 * matching `diffHash`) and the `PreparedDiff` (parsed + segments). The caller
 * decides what to dispatch — this function never touches the store. Used by
 * the React `useDiffPrefetch` hook and by the GUI host's on-demand
 * orchestrator so both code paths share the exact same fetch/parse work.
 */
export async function fetchAndPrepareDiff(
  opts: FetchAndPrepareOpts
): Promise<{ diff: DiffData; hash: string; prepared: PreparedDiff }> {
  const { compareRef, file, headOffset, projectPath, signal } = opts
  const diff = await fetchDiff(file.repoPath ?? projectPath, file, headOffset, compareRef)
  if (signal?.aborted === true) throw new DOMException('Aborted', 'AbortError')
  const hash = diffHash(diff.rawDiff)
  const prepared = await prepareDiff(diff.rawDiff, file.path, { signal })
  if (signal?.aborted === true) throw new DOMException('Aborted', 'AbortError')
  return { diff, hash, prepared }
}

class PrefetchQueue {
  private inflight = new Map<string, AbortController>()
  private queue: Task[] = []
  private running = 0

  constructor(
    private readonly execute: (task: Task) => Promise<void>,
    private readonly maxConcurrency: number
  ) {}

  cancelAll(): void {
    for (const [, controller] of this.inflight) controller.abort()
    this.inflight.clear()
    this.queue = []
  }

  schedule(tasks: Task[]): void {
    const keepKeys = new Set(tasks.map((t) => t.key))
    // Cancel inflight + queued tasks that no longer sit inside the prefetch window.
    for (const [key, controller] of this.inflight) {
      if (!keepKeys.has(key)) {
        controller.abort()
        this.inflight.delete(key)
      }
    }
    this.queue = this.queue.filter((t) => keepKeys.has(t.key))
    for (const task of tasks) {
      if (this.inflight.has(task.key)) continue
      if (this.queue.some((t) => t.key === task.key)) continue
      this.queue.push(task)
    }
    this.queue.sort((a, b) => a.distance - b.distance)
    this.pump()
  }

  private pump(): void {
    while (this.running < this.maxConcurrency && this.queue.length > 0) {
      const task = this.queue.shift()
      if (!task) break
      this.inflight.set(task.key, task.controller)
      this.running += 1
      void (async () => {
        try {
          await this.execute(task)
        } finally {
          this.inflight.delete(task.key)
          this.running -= 1
          this.pump()
        }
      })()
    }
  }
}

// Prefetches ±radius neighbours around the selected file so j/k-style navigation
// hits the cache. Runs through the full pipeline (git → parse → tokenize) off
// the main thread, bounded to MAX_CONCURRENCY to stay below a crowd of git
// subprocesses. Cancels tasks that leave the window on each selection change.
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
  const runTaskRef = useRef<(task: Task) => Promise<void>>(async () => {})

  // Keep a ref to the execute function so the queue keeps the latest closure
  // without needing to recreate the queue itself.
  runTaskRef.current = async (task: Task) => {
    if (!(projectPath != null && projectPath !== '')) return
    try {
      const { diff, hash, prepared } = await fetchAndPrepareDiff({
        compareRef,
        file: task.file,
        headOffset,
        projectPath,
        signal: task.controller.signal,
      })
      if (task.controller.signal.aborted) return
      dispatchGlobal({ diff, hash, key: task.key, type: 'git-mode-set-diff' })
      dispatchGlobal({
        file: prepared.parsed,
        hash: prepared.hash,
        key: task.key,
        type: 'git-mode-set-parsed',
      })
    } catch {
      // Prefetch errors are non-fatal; the foreground fetch will retry on focus.
    }
  }

  if (!queueRef.current) {
    queueRef.current = new PrefetchQueue(async (task) => runTaskRef.current(task), MAX_CONCURRENCY)
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
    const { visibleRows } = buildGitTreeRows(files, collapsedFolders, fileListMode, treeCompaction)
    const fileRows = visibleRows.filter((r) => r.kind === 'file')
    const selectedIdx = fileRows.findIndex((r) => r.key === selectedEntryKey)
    if (selectedIdx < 0) {
      queue.cancelAll()
      return
    }
    const start = Math.max(0, selectedIdx - radius)
    const end = Math.min(fileRows.length, selectedIdx + radius + 1)
    const tasks: Task[] = []
    for (let i = start; i < end; i++) {
      if (i === selectedIdx) continue
      const row = fileRows[i]
      if (!row || row.kind !== 'file') continue
      const key = row.key
      if (diffs[key]) continue
      if (parsed[key]) continue
      if (loading[key] === true) continue
      tasks.push({
        controller: new AbortController(),
        distance: Math.abs(i - selectedIdx),
        file: row.file,
        key,
      })
    }
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
