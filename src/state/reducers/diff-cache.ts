import type { AppState } from '../types'

export function clearDiffCacheForPath(state: AppState, path: string): AppState {
  return clearDiffCacheForPaths(state, new Set([path]))
}

// Drops every cache slice derived from the given file paths: diffs, folds,
// loading flags, parsed patches, and per-theme highlight tokens. Called when
// a file's on-disk content shifts or a file disappears from git status.
export function clearDiffCacheForPaths(state: AppState, paths: Set<string>): AppState {
  if (paths.size === 0) return state
  const nextDiffs = { ...state.gitMode.diffs }
  const nextFolds = { ...state.gitMode.folds }
  const nextLoading = { ...state.gitMode.loading }
  const nextParsed = { ...state.gitMode.parsedFiles }
  const nextHighlights = { ...state.gitMode.highlights }
  let changed = false
  const keyMatches = (key: string): boolean => {
    for (const path of paths) {
      if (key.endsWith(`:${path}`) || key.startsWith(`${path}|`) || key.includes(`:${path}|`)) {
        return true
      }
    }
    return false
  }
  for (const key of Object.keys(nextDiffs)) {
    const entry = nextDiffs[key]
    if (!entry || !paths.has(entry.path)) continue
    delete nextDiffs[key]
    changed = true
  }
  for (const key of Object.keys(nextFolds)) {
    if (!keyMatches(key)) continue
    delete nextFolds[key]
    changed = true
  }
  for (const key of Object.keys(nextLoading)) {
    if (!keyMatches(key)) continue
    delete nextLoading[key]
    changed = true
  }
  for (const key of Object.keys(nextParsed)) {
    if (!keyMatches(key)) continue
    delete nextParsed[key]
    changed = true
  }
  for (const key of Object.keys(nextHighlights)) {
    if (!keyMatches(key)) continue
    delete nextHighlights[key]
    changed = true
  }
  if (!changed) return state
  return {
    ...state,
    gitMode: {
      ...state.gitMode,
      diffs: nextDiffs,
      folds: nextFolds,
      highlights: nextHighlights,
      loading: nextLoading,
      parsedFiles: nextParsed,
    },
  }
}
