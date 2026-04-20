import type { AIUsageToolConfig } from '@brimveyn/aimux-config'

import type { UsageSnapshot } from '../types'

import { runCli } from '../spawn'

interface CodexSessionRow {
  sessionId?: string
  startTime?: string
  inputTokens?: number
  outputTokens?: number
  cacheInputTokens?: number
  totalTokens?: number
  costUSD?: number
}

interface CodexSessionOutput {
  sessions?: CodexSessionRow[]
  totals?: {
    inputTokens?: number
    outputTokens?: number
    cacheInputTokens?: number
    totalTokens?: number
    costUSD?: number
  }
}

export async function fetchCodexUsage(config: AIUsageToolConfig): Promise<UsageSnapshot> {
  const now = new Date().toISOString()
  const base: UsageSnapshot = {
    burnRatePerHour: null,
    costUSD: null,
    lastUpdated: now,
    percent: null,
    resetAt: null,
    timeRemaining: null,
    tokens: { cache: 0, input: 0, output: 0, total: 0 },
    tool: 'codex',
  }

  try {
    const result = await runCli('bunx', [
      '-y',
      '-p',
      '@ccusage/codex',
      'ccusage-codex',
      'session',
      '--since',
      'today',
      '--json',
    ])

    if (!result.ok) {
      return { ...base, error: result.error }
    }

    const parsed = JSON.parse(result.stdout) as CodexSessionOutput
    const totals = parsed.totals ?? {}
    const input = totals.inputTokens ?? 0
    const output = totals.outputTokens ?? 0
    const cache = totals.cacheInputTokens ?? 0
    const total = totals.totalTokens ?? input + output + cache

    let percent: number | null = null
    if (config.codexWeeklyLimit && config.codexWeeklyLimit > 0) {
      percent = Math.max(0, Math.min(100, (total / config.codexWeeklyLimit) * 100))
    }

    return {
      ...base,
      costUSD: totals.costUSD ?? null,
      percent,
      tokens: { cache, input, output, total },
      tool: 'codex',
    }
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
