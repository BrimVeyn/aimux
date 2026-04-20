import type { AIUsageToolConfig } from '@brimveyn/aimux-config'

import type { UsageSnapshot } from '../types'

import { runCli } from '../spawn'

interface ClaudeOAuthCreds {
  accessToken: string
  expiresAt?: number
}

interface ClaudeKeychainPayload {
  claudeAiOauth?: {
    accessToken?: string
    expiresAt?: number
    refreshToken?: string
  }
}

interface UsageWindow {
  utilization?: number
  resets_at?: string
}

interface ClaudeUsageResponse {
  five_hour?: UsageWindow
  seven_day?: UsageWindow
  seven_day_sonnet?: UsageWindow
  seven_day_opus?: UsageWindow
  extra_usage?: UsageWindow & { spent_usd?: number; limit_usd?: number }
}

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const OAUTH_BETA_HEADER = 'oauth-2025-04-20'
const FETCH_TIMEOUT_MS = 15_000

let cachedCreds: ClaudeOAuthCreds | null = null
const CREDS_EXPIRY_BUFFER_MS = 60_000

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
  cachedCreds = { accessToken: access, expiresAt: parsed.claudeAiOauth?.expiresAt }
  return cachedCreds
}

function formatRemainingFromIso(iso: string | undefined): string | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return null
  const totalMin = Math.round(ms / 60_000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}h`
}

export async function fetchClaudeUsage(_config: AIUsageToolConfig): Promise<UsageSnapshot> {
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
      return { ...base, error: 'claude oauth expired — run `claude` to re-auth' }
    }
    if (!response.ok) {
      return { ...base, error: `claude api ${response.status}` }
    }

    const parsed = (await response.json()) as ClaudeUsageResponse
    const fiveHour = parsed.five_hour
    const utilization = typeof fiveHour?.utilization === 'number' ? fiveHour.utilization : null
    const percent = utilization === null ? null : Math.max(0, Math.min(100, utilization))

    return {
      ...base,
      percent,
      resetAt: fiveHour?.resets_at ?? null,
      timeRemaining: formatRemainingFromIso(fiveHour?.resets_at),
      tool: 'claude',
    }
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
