import type { AppAction } from '../actions'

import { type AppState, type DiscoveredRepo, EMPTY_MULTI_REPO_STATE } from '../types'

/**
 * Compute the shortest distinguishing prefix for each non-root repo name.
 *
 * Rule: start at length 1, group by that prefix. Any group with a single name
 * is done; groups with collisions retry at length+1 until distinct or the name
 * is exhausted. Root repos receive an empty prefix (no tag needed).
 */
export function computeRepoPrefixes(repos: DiscoveredRepo[]): Record<string, string> {
  const out: Record<string, string> = {}
  const nonRoot = repos.filter((r) => !r.isRoot)
  for (const r of repos.filter((r) => r.isRoot)) out[r.path] = ''

  const assign = (group: DiscoveredRepo[], len: number): void => {
    if (group.length === 0) return
    if (group.length === 1) {
      const only = group[0]
      if (!only) return
      out[only.path] = only.name.slice(0, Math.max(1, len))
      return
    }
    const byKey = new Map<string, DiscoveredRepo[]>()
    for (const repo of group) {
      const key = repo.name.slice(0, len)
      const bucket = byKey.get(key)
      if (bucket) bucket.push(repo)
      else byKey.set(key, [repo])
    }
    for (const [key, bucket] of byKey) {
      if (bucket.length === 1 || bucket.every((r) => r.name.length < len)) {
        for (const r of bucket) out[r.path] = key || r.name
      } else {
        assign(bucket, len + 1)
      }
    }
  }
  assign(nonRoot, 1)
  return out
}

export function reduceMultiRepoState(state: AppState, action: AppAction): AppState | null {
  switch (action.type) {
    case 'multi-repo-set-repos': {
      const prefixes = computeRepoPrefixes(action.repos)
      return { ...state, multiRepo: { prefixes, repos: action.repos } }
    }
    case 'multi-repo-clear': {
      if (state.multiRepo.repos.length === 0) return state
      return { ...state, multiRepo: EMPTY_MULTI_REPO_STATE }
    }
    default:
      return null
  }
}
