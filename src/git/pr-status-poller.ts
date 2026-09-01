import { useEffect } from 'react'

import { prStatusStore } from '../state/pr-status-store'
import { collectPrStatus } from './pr-status'

/** A run in flight is worth watching closely; a settled one barely changes. */
const ACTIVE_INTERVAL_MS = 15_000
const IDLE_INTERVAL_MS = 60_000
const MAX_INTERVAL_MS = 120_000

interface Options {
  enabled: boolean
  projectPath: string | undefined
}

/** One-shot refetch, for when an action we took just invalidated the state. */
export async function refreshPrStatus(projectPath: string): Promise<void> {
  prStatusStore.getState().setResult(projectPath, await collectPrStatus(projectPath))
}

/**
 * Headless PR-status poll. Returns a disposer. The GUI host has no React root,
 * so it drives the same loop directly; the hook below is the TUI's.
 */
export function startPrStatusPolling({ enabled, projectPath }: Options): () => void {
  {
    if (!enabled || !(projectPath != null && projectPath !== '')) return () => {}

    // Show what we last knew about this path while the fetch runs in the
    // background, rather than blanking the row on every workspace switch.
    prStatusStore.getState().selectPath(projectPath)

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let delay = ACTIVE_INTERVAL_MS

    const schedule = () => {
      if (cancelled) return
      timer = setTimeout(() => void tick(), delay)
    }

    const tick = async () => {
      const result = await collectPrStatus(projectPath)
      if (cancelled) return
      prStatusStore.getState().setResult(projectPath, result)
      if (result.kind === 'error') {
        delay = Math.min(delay * 2, MAX_INTERVAL_MS)
      } else if (result.kind === 'ok' && result.checks.some((c) => c.state === 'pending')) {
        delay = ACTIVE_INTERVAL_MS
      } else {
        delay = IDLE_INTERVAL_MS
      }
      schedule()
    }

    void tick()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }
}

export function usePrStatusPolling({ enabled, projectPath }: Options): void {
  useEffect(() => startPrStatusPolling({ enabled, projectPath }), [enabled, projectPath])
}
