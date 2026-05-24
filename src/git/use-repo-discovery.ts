import { getMultiRepoConfig } from '@brimveyn/aimux-config'
import { useEffect } from 'react'

import { dispatchGlobal } from '../state/dispatch-ref'
import { discoverRepos } from './repo-discovery'

/**
 * Discover nested git repos inside `projectPath` once per session and push
 * the result into state. No-op when the multi-repo config flag is off.
 */
export function useRepoDiscovery(projectPath: string | undefined): void {
  useEffect(() => {
    const cfg = getMultiRepoConfig()
    if (!cfg.enabled || !(projectPath != null && projectPath !== '')) {
      dispatchGlobal({ type: 'multi-repo-clear' })
      return
    }
    dispatchGlobal({ type: 'multi-repo-clear' })
    let cancelled = false
    void (async () => {
      const repos = await discoverRepos(projectPath, cfg.maxDepth)
      if (cancelled) return
      dispatchGlobal({ repos, type: 'multi-repo-set-repos' })
    })()
    return () => {
      cancelled = true
    }
  }, [projectPath])
}
