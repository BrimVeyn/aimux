import type { AIUsageTool, AIUsageToolConfig } from '@brimveyn/aimux-config'

import type { UsageSnapshot } from './types'

import { getAssistantDefinition } from '../../pty/assistant-registry'
import { fetchClaudeUsage } from './adapters/claude'
import { fetchCodexUsage } from './adapters/codex'
import { loadCachedSnapshot, saveCachedSnapshot } from './cache'

/**
 * Claude's OAuth usage endpoint drops a caller polling faster than this into a
 * punitive rate-limit bucket, which shows up as an indicator that stops updating
 * rather than as an error. So it is the floor as well as the default, and it is
 * not per-tool: one interval drives every tool in the list, and a Codex-only
 * setup loses nothing measurable by refreshing a quota bar every three minutes.
 */
const MIN_POLL_SECONDS = 180
const DEFAULT_TOOLS: AIUsageTool[] = ['claude', 'codex']

function emptySnapshot(tool: AIUsageTool): UsageSnapshot {
  return {
    burnRatePerHour: null,
    costUSD: null,
    lastUpdated: new Date().toISOString(),
    percent: null,
    planTier: null,
    resetAt: null,
    timeRemaining: null,
    tokens: { cache: 0, input: 0, output: 0, total: 0 },
    tool,
    windows: [],
  }
}

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
    default: {
      // A plugin assistant that declared a `usage` adapter. Anything else has
      // no quota to report; an empty snapshot renders as "no data" rather than
      // as an error the user cannot act on.
      const usage = getAssistantDefinition(tool)?.usage
      return usage ? usage(config) : emptySnapshot(tool)
    }
  }
}

export function startAIUsageService(
  config: AIUsageToolConfig,
  onUpdate: (snap: UsageSnapshot) => void
): AIUsageServiceHandle {
  const tools = config.tools && config.tools.length > 0 ? config.tools : DEFAULT_TOOLS
  const pollMs = Math.max(MIN_POLL_SECONDS, config.pollSeconds ?? MIN_POLL_SECONDS) * 1000

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
      const results = await Promise.allSettled(toFetch.map(async (t) => fetchFor(t, config)))
      if (stopped) return
      for (let i = 0; i < results.length; i++) {
        const result = results[i]
        const tool = toFetch[i]
        if (!result || tool === undefined) continue
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
