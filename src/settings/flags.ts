import { loadConfig } from '../config'
import { COPY_FILES, COPY_FILES_DEFAULT, FETCH_BASE } from './sections/git'

/**
 * Settings read outside the screen, off the file rather than the store.
 *
 * `live.ts` is the same read side for the running TUI, through hooks over the
 * hydrated store. These have to answer where there is no store: the CLI never
 * hydrates one, and a setting only the TUI honours is a setting that lies.
 */

/** Whether a new workspace forks from the base as pushed, or as last pulled. */
export function shouldRefreshBase(): boolean {
  return loadConfig().settings?.[FETCH_BASE] !== false
}

/** Untracked files a new workspace is seeded with, as globs relative to the repo. */
export function worktreeCopyPatterns(): string[] {
  const value = loadConfig().settings?.[COPY_FILES]
  // Only an explicit empty string disables it; an untouched setting gets `.env`.
  return String(value ?? COPY_FILES_DEFAULT)
    .split(',')
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern !== '')
}
