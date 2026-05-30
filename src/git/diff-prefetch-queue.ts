import type { DiffData, GitFileEntry, GitFileListMode, ParsedDiffEntry } from '../state/types'

import { dispatchGlobal } from '../state/dispatch-ref'
import { buildGitTreeRows } from '../state/git-tree'
import { type PreparedDiff, prepareDiff } from '../ui/components/git/diff-renderer/prepare-diff'
import { diffHash } from './diff-hash'
import { fetchDiff } from './git-diff'

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
 * decides what to dispatch — this function never touches the store. Shared
 * by the React `useDiffPrefetch` hook, the GUI host's on-demand orchestrator,
 * and the GUI host's prefetch driver so all three paths run the same
 * fetch/parse work.
 */
export async function fetchAndPrepareDiff(
  opts: FetchAndPrepareOpts
): Promise<{ diff: DiffData; hash: string; prepared: PreparedDiff }> {
  const { compareRef, file, headOffset, projectPath, signal } = opts
  const diff = await fetchDiff(file.repoPath ?? projectPath, file, headOffset, compareRef)
  if (signal?.aborted ?? false) throw new DOMException('Aborted', 'AbortError')
  const hash = diffHash(diff.rawDiff)
  const prepared = await prepareDiff(diff.rawDiff, file.path, { signal })
  if (signal?.aborted ?? false) throw new DOMException('Aborted', 'AbortError')
  return { diff, hash, prepared }
}

/**
 * Shared headless prefetch core for the diff radius prefetch. Owns the
 * concurrency-bounded task queue and the run loop. Both the React hook
 * (`useDiffPrefetch`) and the GUI host driver (`startDiffPrefetchDriver`)
 * delegate to this module so the scheduling algorithm has a single source
 * of truth.
 */

export const MAX_PREFETCH_CONCURRENCY = 3

export interface PrefetchTask {
  controller: AbortController
  distance: number
  file: GitFileEntry
  key: string
}

export class PrefetchQueue {
  private inflight = new Map<string, AbortController>()
  private queue: PrefetchTask[] = []
  private running = 0

  constructor(
    private readonly execute: (task: PrefetchTask) => Promise<void>,
    private readonly maxConcurrency: number
  ) {}

  cancelAll(): void {
    for (const [, controller] of this.inflight) controller.abort()
    this.inflight.clear()
    this.queue = []
  }

  schedule(tasks: PrefetchTask[]): void {
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

export interface BuildPrefetchTasksInput {
  collapsedFolders: Record<string, true>
  diffs: Record<string, DiffData | undefined>
  fileListMode: GitFileListMode
  files: GitFileEntry[]
  loading: Record<string, boolean | undefined>
  parsed: Record<string, ParsedDiffEntry>
  radius: number
  selectedEntryKey: string
  treeCompaction: boolean
}

/**
 * Pure planner — returns the list of prefetch tasks that should be active
 * for the given selection. Skips entries that already have a diff/parsed
 * cache entry or are currently loading. Returns an empty array when the
 * selection isn't a visible file row.
 */
export function buildPrefetchTasks(input: BuildPrefetchTasksInput): PrefetchTask[] {
  const {
    collapsedFolders,
    diffs,
    fileListMode,
    files,
    loading,
    parsed,
    radius,
    selectedEntryKey,
    treeCompaction,
  } = input
  const { visibleRows } = buildGitTreeRows(files, collapsedFolders, fileListMode, treeCompaction)
  const fileRows = visibleRows.filter((r) => r.kind === 'file')
  const selectedIdx = fileRows.findIndex((r) => r.key === selectedEntryKey)
  if (selectedIdx < 0) return []
  const start = Math.max(0, selectedIdx - radius)
  const end = Math.min(fileRows.length, selectedIdx + radius + 1)
  const tasks: PrefetchTask[] = []
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
  return tasks
}

export interface RunPrefetchTaskInput {
  compareRef: string | undefined
  headOffset: number
  projectPath: string
  task: PrefetchTask
}

/**
 * Default per-task runner used by both the hook and the GUI driver. Runs
 * the fetch + parse pipeline and dispatches the diff/parsed actions on
 * success. Errors are swallowed (prefetch is best-effort; the foreground
 * fetch retries on focus). Does NOT dispatch loading — radius prefetch
 * is silent background work.
 */
export async function runPrefetchTask(input: RunPrefetchTaskInput): Promise<void> {
  const { compareRef, headOffset, projectPath, task } = input
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
