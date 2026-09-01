import { getMultiRepoConfig } from '@brimveyn/aimux-config'

import type { AppAction } from '../state/actions'

import { logDebug } from '../debug/input-log'
import { discoverRepos } from '../git/repo-discovery'

interface DriverOptions {
  dispatch: (action: AppAction) => void
}

/**
 * Headless port of `useRepoDiscovery`. The GUI host has no React root, so
 * call `.update(projectPath)` whenever the active session's project path
 * changes. Each call cancels any in-flight discoverRepos so a fast
 * session-switch can't race a stale result into state.
 *
 * Returns a disposer that cancels the latest in-flight run (call on host
 * shutdown so a hanging discoverRepos doesn't pin the process).
 */
export function startMultiRepoDiscoveryDriver({ dispatch }: DriverOptions): {
  update: (projectPath: string | undefined) => void
  dispose: () => void
} {
  let cancelLatest: (() => void) | null = null
  let lastProjectPath: string | undefined | null = null

  const run = (projectPath: string | undefined): void => {
    cancelLatest?.()
    const cfg = getMultiRepoConfig()
    if (!cfg.enabled || projectPath == null || projectPath === '') {
      dispatch({ type: 'multi-repo-clear' })
      cancelLatest = null
      logDebug('gui.host.multiRepoDiscovery.skip', {
        enabled: cfg.enabled,
        projectPath: projectPath ?? null,
      })
      return
    }

    dispatch({ type: 'multi-repo-clear' })
    let cancelled = false
    cancelLatest = () => {
      cancelled = true
    }
    logDebug('gui.host.multiRepoDiscovery.start', {
      maxDepth: cfg.maxDepth,
      projectPath,
    })
    void (async () => {
      try {
        const repos = await discoverRepos(projectPath, cfg.maxDepth)
        if (cancelled) {
          logDebug('gui.host.multiRepoDiscovery.cancelled', { projectPath })
          return
        }
        logDebug('gui.host.multiRepoDiscovery.done', {
          count: repos.length,
          projectPath,
        })
        dispatch({ repos, type: 'multi-repo-set-repos' })
      } catch (error) {
        logDebug('gui.host.multiRepoDiscovery.error', {
          error: error instanceof Error ? error.message : String(error),
          projectPath,
        })
      }
    })()
  }

  return {
    dispose() {
      cancelLatest?.()
      cancelLatest = null
    },
    update(projectPath) {
      // Idempotent — repeated calls with the same path are no-ops so the
      // host can call this from every store-subscribe without flapping.
      if (projectPath === lastProjectPath) return
      lastProjectPath = projectPath
      run(projectPath)
    },
  }
}
