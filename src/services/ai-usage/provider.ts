import type { AIUsageTool, AIUsageToolConfig } from '@brimveyn/aimux-config'

import type { UsageSnapshot } from './types'

import { fetchClaudeUsage } from './adapters/claude'
import { fetchCodexUsage } from './adapters/codex'
import { loadCachedSnapshot, saveCachedSnapshot } from './cache'

const DEFAULT_POLL_SECONDS = 60
const DEFAULT_TOOLS: AIUsageTool[] = ['claude', 'codex']

export interface AIUsageServiceHandle {
  stop: () => void
  refresh: () => void
}

async function fetchFor(tool: AIUsageTool, config: AIUsageToolConfig): Promise<UsageSnapshot> {
  switch (tool) {
    case 'claude':
      return fetchClaudeUsage(config)
    case 'codex':
      return fetchCodexUsage(config)
  }
}

export function startAIUsageService(
  config: AIUsageToolConfig,
  onUpdate: (snap: UsageSnapshot) => void
): AIUsageServiceHandle {
  const tools = config.tools && config.tools.length > 0 ? config.tools : DEFAULT_TOOLS
  const pollMs = Math.max(5, config.pollSeconds ?? DEFAULT_POLL_SECONDS) * 1000

  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const tick = async (): Promise<void> => {
    if (stopped) return

    const toFetch: AIUsageTool[] = []
    let maxCachedAgeMs = 0
    for (const tool of tools) {
      const cached = loadCachedSnapshot(tool, pollMs)
      if (cached) {
        onUpdate(cached.snapshot)
        if (cached.ageMs > maxCachedAgeMs) maxCachedAgeMs = cached.ageMs
      } else {
        toFetch.push(tool)
      }
    }

    if (toFetch.length > 0) {
      const results = await Promise.allSettled(toFetch.map((t) => fetchFor(t, config)))
      if (stopped) return
      for (let i = 0; i < results.length; i++) {
        const result = results[i]
        const tool = toFetch[i]
        if (!result || !tool) continue
        if (result.status === 'fulfilled') {
          saveCachedSnapshot(result.value)
          onUpdate(result.value)
        } else {
          onUpdate({
            burnRatePerHour: null,
            costUSD: null,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
            lastUpdated: new Date().toISOString(),
            percent: null,
            planTier: null,
            resetAt: null,
            timeRemaining: null,
            tokens: { cache: 0, input: 0, output: 0, total: 0 },
            tool,
            windows: [],
          })
        }
      }
    }

    if (!stopped) {
      const minDelayMs = 5_000
      const nextDelayMs =
        toFetch.length > 0 ? pollMs : Math.max(minDelayMs, pollMs - maxCachedAgeMs)
      timer = setTimeout(() => {
        void tick()
      }, nextDelayMs)
    }
  }

  void tick()

  return {
    refresh: () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      void tick()
    },
    stop: () => {
      stopped = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}
