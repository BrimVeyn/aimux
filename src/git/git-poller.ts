import { useEffect } from 'react'

import type { DiscoveredRepo, GitFileEntry, GitRefreshPayload } from '../state/types'

import { workingTreeHash } from '../auto-commit/working-tree-hash'
import { useAppStore } from '../state/app-store'
import { dispatchGlobal } from '../state/dispatch-ref'
import { emitUiPluginEvent } from '../ui/plugin-events-ref'
import { collectGitStatus, type GitCollectResult } from './git-status'

const BASE_INTERVAL_MS = 1000
const MAX_INTERVAL_MS = 30_000

interface Options {
  enabled: boolean
  projectPath: string | undefined
  headOffset: number
  // When set, diff the working tree against this ref (workspace fork point for
  // review-vs-base) instead of HEAD/HEAD~N.
  compareRef?: string
}

function tagFiles(files: GitFileEntry[], repoPath: string): GitFileEntry[] {
  return files.map((f) => ({ ...f, repoPath }))
}

async function collectAggregated(
  repos: DiscoveredRepo[],
  fallbackCwd: string,
  headOffset: number,
  compareRef: string | undefined
): Promise<GitCollectResult> {
  // Historical walking (HEAD~N) and review-vs-base are per-repo and don't
  // compose; fall back to the root/fallback repo to preserve existing behaviour.
  if ((compareRef != null && compareRef !== '') || headOffset > 0) {
    const result = await collectGitStatus(fallbackCwd, { compareRef, headOffset })
    if (result.kind !== 'ok') return result
    return {
      kind: 'ok',
      payload: { ...result.payload, files: tagFiles(result.payload.files, fallbackCwd) },
    }
  }

  const results = await Promise.all(
    repos.map(async (r) => collectGitStatus(r.path, { headOffset: 0 }))
  )
  const files: GitFileEntry[] = []
  let branch: string | null = null
  let ahead = 0
  let behind = 0
  let anyOk = false
  for (let i = 0; i < repos.length; i++) {
    const res = results[i]
    const repo = repos[i]
    if (res?.kind !== 'ok' || !repo) continue
    anyOk = true
    if (repo.isRoot) {
      branch = res.payload.branch
      ahead = res.payload.ahead
      behind = res.payload.behind
    }
    files.push(...tagFiles(res.payload.files, repo.path))
  }
  if (!anyOk) return { error: 'not-a-repo', kind: 'error' }
  // If there was no root repo, surface the first discovered repo's branch label.
  if (branch === null) {
    const firstOk = results.find(
      (r): r is Extract<GitCollectResult, { kind: 'ok' }> => r?.kind === 'ok'
    )
    if (firstOk) branch = firstOk.payload.branch
  }
  const payload: GitRefreshPayload = { ahead, behind, branch, files }
  return { kind: 'ok', payload }
}

/** The event name a plugin listens for with `ctx.on(...)`. */
export const GIT_WORKING_TREE_CHANGED = 'git:workingTreeChanged'

export interface WorkingTreeChangedEvent {
  repoRoot: string
  branch: string | null
  ahead: number
  behind: number
  files: {
    path: string
    status: string
    section: string
    added: number | null
    removed: number | null
  }[]
}

/**
 * The event for a poll, or null when the tree has not moved.
 *
 * The poll runs every few seconds whether or not anything changed, and a plugin
 * woken on every tick is a plugin nobody keeps installed — so the hash decides,
 * and it is the same hash auto-commit uses to know its suggestion went stale.
 */
export function workingTreeChange(
  payload: GitRefreshPayload,
  repoRoot: string,
  lastHash: string
): { hash: string; event: WorkingTreeChangedEvent } | null {
  const hash = workingTreeHash(payload)
  if (hash === lastHash) return null
  return {
    event: {
      ahead: payload.ahead,
      behind: payload.behind,
      branch: payload.branch,
      files: payload.files.map((file) => ({
        added: file.added,
        path: file.path,
        removed: file.removed,
        section: file.section,
        status: file.status,
      })),
      repoRoot,
    },
    hash,
  }
}

export function useGitPanelPolling({
  compareRef,
  enabled,
  headOffset,
  projectPath,
}: Options): void {
  // Read repos from the store imperatively — changes trigger a fresh effect run
  // because the repos identity is stable across ticks until set-repos fires.
  const repos = useAppStore((s) => s.multiRepo.repos)

  useEffect(() => {
    if (!enabled || !(projectPath != null && projectPath !== '')) return

    dispatchGlobal({ type: 'git-panel-reset' })

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let delay = BASE_INTERVAL_MS
    // Per-effect, so switching project re-announces the tree rather than
    // staying silent because the previous one happened to hash the same.
    let lastHash = ''

    const schedule = () => {
      if (cancelled) return
      timer = setTimeout(() => void tick(), delay)
    }

    const tick = async () => {
      const result =
        repos.length > 0
          ? await collectAggregated(repos, projectPath, headOffset, compareRef)
          : await collectGitStatus(projectPath, { compareRef, headOffset })
      if (cancelled) return
      if (result.kind === 'ok') {
        const payload =
          repos.length === 0
            ? { ...result.payload, files: tagFiles(result.payload.files, projectPath) }
            : result.payload
        dispatchGlobal({ payload, type: 'git-refresh-success' })
        const moved = workingTreeChange(payload, projectPath, lastHash)
        if (moved !== null) {
          lastHash = moved.hash
          emitUiPluginEvent(GIT_WORKING_TREE_CHANGED, moved.event)
        }
        delay = BASE_INTERVAL_MS
      } else if (result.kind === 'out-of-range') {
        dispatchGlobal({ offset: result.maxOffset, type: 'git-mode-set-head-offset' })
        dispatchGlobal({
          message: `no older commit — clamped to HEAD~${result.maxOffset}`,
          type: 'git-mode-set-message',
        })
        delay = BASE_INTERVAL_MS
      } else {
        dispatchGlobal({ kind: result.error, type: 'git-refresh-error' })
        delay = Math.min(delay * 2, MAX_INTERVAL_MS)
      }
      schedule()
    }

    void tick()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [enabled, projectPath, headOffset, compareRef, repos])
}
