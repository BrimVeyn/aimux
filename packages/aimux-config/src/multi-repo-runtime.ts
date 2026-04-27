import type { MultiRepoConfig } from './types'

import { DEFAULT_MULTI_REPO_CONFIG } from './defaults'

/**
 * Module-level mirror of `multiRepo` from the resolved config.
 *
 * Set once at startup via `setMultiRepoConfig(resolvedConfig.multiRepo)`. Read
 * by non-React code paths (discovery, poller merge) that need the flag and depth.
 */

let current: MultiRepoConfig = DEFAULT_MULTI_REPO_CONFIG

export function setMultiRepoConfig(value: MultiRepoConfig): void {
  current = value
}

export function getMultiRepoConfig(): MultiRepoConfig {
  return current
}
