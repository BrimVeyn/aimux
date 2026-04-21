import type { AIUsageTool } from '@brimveyn/aimux-config'

export type { AIUsageTool }

export interface UsageSnapshot {
  tool: AIUsageTool
  percent: number | null
  tokens: {
    input: number
    output: number
    cache: number
    total: number
  }
  costUSD: number | null
  resetAt: string | null
  timeRemaining: string | null
  burnRatePerHour: number | null
  lastUpdated: string
  error?: string
  stale?: boolean
}
