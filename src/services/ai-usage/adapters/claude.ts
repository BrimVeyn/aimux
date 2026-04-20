import type { AIUsageToolConfig } from '@brimveyn/aimux-config'

import type { UsageSnapshot } from '../types'

import { runCli } from '../spawn'

interface CcusageBlock {
  id?: string
  isActive?: boolean
  blockStart?: string
  blockEnd?: string
  timeRemaining?: string
  inputTokens?: number
  outputTokens?: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
  totalTokens?: number
  costUSD?: number
  burnRate?: number | { tokensPerHour?: number; tokensPerMinute?: number }
  tokenLimitStatus?: {
    limit?: number
    percentUsed?: number
  }
}

interface CcusageBlocksOutput {
  blocks?: CcusageBlock[]
}

function resolvePlanFlag(plan: AIUsageToolConfig['claudePlan']): string {
  switch (plan) {
    case 'pro':
    case 'max5':
    case 'max20':
      return plan
    case 'auto':
    default:
      return 'max'
  }
}

function extractBurnRate(raw: CcusageBlock['burnRate']): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return raw
  if (typeof raw === 'object') {
    if (typeof raw.tokensPerHour === 'number') return raw.tokensPerHour
    if (typeof raw.tokensPerMinute === 'number') return raw.tokensPerMinute * 60
  }
  return null
}

export async function fetchClaudeUsage(config: AIUsageToolConfig): Promise<UsageSnapshot> {
  const now = new Date().toISOString()
  const base: UsageSnapshot = {
    burnRatePerHour: null,
    costUSD: null,
    lastUpdated: now,
    percent: null,
    resetAt: null,
    timeRemaining: null,
    tokens: { cache: 0, input: 0, output: 0, total: 0 },
    tool: 'claude',
  }

  try {
    const planFlag = resolvePlanFlag(config.claudePlan)
    const result = await runCli('bunx', [
      '-y',
      'ccusage',
      'blocks',
      '--active',
      '--json',
      '--token-limit',
      planFlag,
    ])

    if (!result.ok) {
      return { ...base, error: result.error }
    }

    const parsed = JSON.parse(result.stdout) as CcusageBlocksOutput
    const active = parsed.blocks?.find((b) => b.isActive) ?? parsed.blocks?.[0]
    if (!active) {
      return { ...base, error: 'no-active-block' }
    }

    const input = active.inputTokens ?? 0
    const output = active.outputTokens ?? 0
    const cache = (active.cacheCreationTokens ?? 0) + (active.cacheReadTokens ?? 0)
    const total = active.totalTokens ?? input + output + cache

    let percent = active.tokenLimitStatus?.percentUsed ?? null
    if (percent === null && active.tokenLimitStatus?.limit) {
      percent = (total / active.tokenLimitStatus.limit) * 100
    }
    if (percent !== null) percent = Math.max(0, Math.min(100, percent))

    return {
      ...base,
      burnRatePerHour: extractBurnRate(active.burnRate),
      costUSD: active.costUSD ?? null,
      percent,
      resetAt: active.blockEnd ?? null,
      timeRemaining: active.timeRemaining ?? null,
      tokens: { cache, input, output, total },
      tool: 'claude',
    }
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
