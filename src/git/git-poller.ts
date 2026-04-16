import { useEffect } from 'react'

import { dispatchGlobal } from '../state/dispatch-ref'
import { collectGitStatus } from './git-status'

const BASE_INTERVAL_MS = 1000
const MAX_INTERVAL_MS = 30_000

interface Options {
  enabled: boolean
  projectPath: string | undefined
}

export function useGitPanelPolling({ enabled, projectPath }: Options): void {
  useEffect(() => {
    if (!enabled || !projectPath) return undefined

    dispatchGlobal({ type: 'git-panel-reset' })

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let delay = BASE_INTERVAL_MS

    const schedule = () => {
      if (cancelled) return
      timer = setTimeout(() => void tick(), delay)
    }

    const tick = async () => {
      const result = await collectGitStatus(projectPath)
      if (cancelled) return
      if (result.kind === 'ok') {
        dispatchGlobal({ payload: result.payload, type: 'git-refresh-success' })
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
  }, [enabled, projectPath])
}
