import type { AIUsageToolConfig } from '@brimveyn/aimux-config'

import type { UsageSnapshot, UsageWindow, UsageWindowKind } from '../types'

import { computePace, formatTimeRemaining } from '../pace'
import { runCli } from '../spawn'

interface ClaudeOAuthCreds {
  accessToken: string
  expiresAt?: number
  planTier: string | null
}

interface ClaudeKeychainPayload {
  claudeAiOauth?: {
    accessToken?: string
    expiresAt?: number
    refreshToken?: string
    rateLimitTier?: string
    rate_limit_tier?: string
    subscriptionType?: string
    scopes?: string[]
  }
}

interface UsageWindowPayload {
  utilization?: number
  resets_at?: string
}

interface ClaudeUsageResponse {
  five_hour?: UsageWindowPayload
  seven_day?: UsageWindowPayload
  seven_day_sonnet?: UsageWindowPayload
  seven_day_opus?: UsageWindowPayload
  extra_usage?: UsageWindowPayload & { spent_usd?: number; limit_usd?: number }
}

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const OAUTH_BETA_HEADER = 'oauth-2025-04-20'
const FETCH_TIMEOUT_MS = 15_000

const FIVE_HOUR_SECONDS = 5 * 60 * 60
const SEVEN_DAY_SECONDS = 7 * 24 * 60 * 60

let cachedCreds: ClaudeOAuthCreds | null = null
const CREDS_EXPIRY_BUFFER_MS = 60_000

function normalizePlanTier(raw: string | undefined | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()
  if (lower.includes('max')) return 'Max'
  if (lower.includes('pro')) return 'Pro'
  if (lower.includes('team')) return 'Team'
  if (lower.includes('enterprise')) return 'Enterprise'
  if (lower.includes('ultra')) return 'Ultra'
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

function planTierFromPayload(payload: ClaudeKeychainPayload): string | null {
  const o = payload.claudeAiOauth
  if (!o) return null
  const raw = o.rateLimitTier ?? o.rate_limit_tier ?? o.subscriptionType
  const normalized = normalizePlanTier(raw)
  if (normalized) return normalized
  if (Array.isArray(o.scopes)) {
    for (const scope of o.scopes) {
      const s = scope.toLowerCase()
      if (s.includes('max')) return 'Max'
      if (s.includes('pro')) return 'Pro'
      if (s.includes('team')) return 'Team'
      if (s.includes('enterprise')) return 'Enterprise'
    }
  }
  return null
}

async function readClaudeCreds(): Promise<ClaudeOAuthCreds> {
  const now = Date.now()
  if (
    cachedCreds &&
    typeof cachedCreds.expiresAt === 'number' &&
    cachedCreds.expiresAt - CREDS_EXPIRY_BUFFER_MS > now
  ) {
    return cachedCreds
  }

  if (process.platform !== 'darwin') {
    throw new Error('claude usage requires macOS keychain (darwin only)')
  }
  const result = await runCli('security', [
    'find-generic-password',
    '-s',
    'Claude Code-credentials',
    '-w',
  ])
  if (!result.ok) {
    throw new Error(`keychain read failed — run \`claude\` to sign in`)
  }
  const parsed = JSON.parse(result.stdout.trim()) as ClaudeKeychainPayload
  const access = parsed.claudeAiOauth?.accessToken
  if (!access) {
    throw new Error('no accessToken in Claude Code keychain')
  }
  cachedCreds = {
    accessToken: access,
    expiresAt: parsed.claudeAiOauth?.expiresAt,
    planTier: planTierFromPayload(parsed),
  }
  return cachedCreds
}

function buildWindow(
  kind: UsageWindowKind,
  label: string,
  payload: UsageWindowPayload | undefined,
  windowSeconds: number,
  now: number
): UsageWindow | null {
  if (!payload) return null
  const util = typeof payload.utilization === 'number' ? payload.utilization : null
  const percent = util === null ? null : Math.max(0, Math.min(100, util))
  const resetAt = payload.resets_at ?? null
  const resetAtMs = resetAt ? new Date(resetAt).getTime() : null
  if (percent === null && !resetAt) return null
  return {
    kind,
    label,
    pace: kind === 'weekly' ? computePace({ now, percent, resetAtMs, windowSeconds }) : null,
    percent,
    resetAt,
    timeRemaining: formatTimeRemaining(resetAtMs, now),
    windowSeconds,
  }
}

export async function fetchClaudeUsage(_config: AIUsageToolConfig): Promise<UsageSnapshot> {
  const nowIso = new Date().toISOString()
  const base: UsageSnapshot = {
    burnRatePerHour: null,
    costUSD: null,
    lastUpdated: nowIso,
    percent: null,
    planTier: null,
    resetAt: null,
    timeRemaining: null,
    tokens: { cache: 0, input: 0, output: 0, total: 0 },
    tool: 'claude',
    windows: [],
  }

  try {
    const creds = await readClaudeCreds()

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(USAGE_URL, {
        headers: {
          'anthropic-beta': OAUTH_BETA_HEADER,
          'Authorization': `Bearer ${creds.accessToken}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }

    if (response.status === 401 || response.status === 403) {
      cachedCreds = null
      return {
        ...base,
        error: 'claude oauth expired — run `claude` to re-auth',
        planTier: creds.planTier,
      }
    }
    if (!response.ok) {
      return { ...base, error: `claude api ${response.status}`, planTier: creds.planTier }
    }

    const parsed = (await response.json()) as ClaudeUsageResponse
    const now = Date.now()

    const windows: UsageWindow[] = []
    const session = buildWindow('session', 'Session', parsed.five_hour, FIVE_HOUR_SECONDS, now)
    if (session) windows.push(session)
    const weekly = buildWindow('weekly', 'Weekly', parsed.seven_day, SEVEN_DAY_SECONDS, now)
    if (weekly) windows.push(weekly)
    const opus = buildWindow('opus', 'Opus', parsed.seven_day_opus, SEVEN_DAY_SECONDS, now)
    if (opus) windows.push(opus)
    const sonnet = buildWindow('sonnet', 'Sonnet', parsed.seven_day_sonnet, SEVEN_DAY_SECONDS, now)
    if (sonnet) windows.push(sonnet)

    const summary = session ?? weekly

    return {
      ...base,
      percent: summary?.percent ?? null,
      planTier: creds.planTier,
      resetAt: summary?.resetAt ?? null,
      timeRemaining: summary?.timeRemaining ?? null,
      tool: 'claude',
      windows,
    }
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
