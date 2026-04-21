import type { AIUsageTool } from '@brimveyn/aimux-config'

export type { AIUsageTool }

export type UsageWindowKind = 'session' | 'weekly' | 'sonnet' | 'opus' | 'primary' | 'secondary'

export type UsagePaceStage =
  | 'farAhead'
  | 'ahead'
  | 'slightlyAhead'
  | 'onTrack'
  | 'slightlyBehind'
  | 'behind'
  | 'farBehind'

export interface UsagePace {
  delta: number
  stage: UsagePaceStage
  label: string
  rightText: string | null
}

export interface UsageWindow {
  kind: UsageWindowKind
  label: string
  percent: number | null
  resetAt: string | null
  timeRemaining: string | null
  windowSeconds: number | null
  pace: UsagePace | null
}

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
  planTier: string | null
  windows: UsageWindow[]
  error?: string
  stale?: boolean
}
