import type { AIUsageTool } from '@brimveyn/aimux-config'

export type { AIUsageTool }

/**
 * Identity of a window, and the key it renders under. Well-known values are
 * `session`, `weekly`, `primary` and `secondary`; per-model weekly ceilings use
 * the model's own name lowercased (`opus`, `sonnet`, `fable`, …), which the
 * provider adds to over time, so this stays open rather than a closed union.
 */
export type UsageWindowKind = string

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
