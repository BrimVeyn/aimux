import type { AIUsageToolConfig } from '@brimveyn/aimux-config'

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { UsageSnapshot, UsageWindow, UsageWindowKind } from '../types'

import { computePace, formatTimeRemaining } from '../pace'

interface CodexAuthFile {
  tokens?: {
    access_token?: string
    account_id?: string
  }
}

interface WindowSnapshot {
  used_percent?: number
  reset_at?: number
  limit_window_seconds?: number
}

interface CodexUsageResponse {
  plan_type?: string
  rate_limit?: {
    primary_window?: WindowSnapshot | null
    secondary_window?: WindowSnapshot | null
  }
  credits?: {
    has_credits?: boolean
    unlimited?: boolean
    balance?: number | string | null
  }
}

const DEFAULT_CHATGPT_BASE = 'https://chatgpt.com/backend-api'
const USAGE_PATH = '/wham/usage'
const AUTH_TIMEOUT_MS = 15_000

export function codexHome(): string {
  const env = process.env.CODEX_HOME?.trim()
  if (env != null && env !== '') return env
  return join(homedir(), '.codex')
}

function parseChatGPTBaseFromConfig(contents: string): string | null {
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.split('#', 1)[0]?.trim() ?? ''
    if (!line) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    if (key !== 'chatgpt_base_url') continue
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    return value.trim()
  }
  return null
}

function normalizeBase(value: string): string {
  let trimmed = value.trim() || DEFAULT_CHATGPT_BASE
  while (trimmed.endsWith('/')) trimmed = trimmed.slice(0, -1)
  if (
    (trimmed.startsWith('https://chatgpt.com') || trimmed.startsWith('https://chat.openai.com')) &&
    !trimmed.includes('/backend-api')
  ) {
    trimmed += '/backend-api'
  }
  return trimmed
}

async function resolveUsageURL(): Promise<string> {
  let base = DEFAULT_CHATGPT_BASE
  try {
    const contents = await readFile(join(codexHome(), 'config.toml'), 'utf8')
    const parsed = parseChatGPTBaseFromConfig(contents)
    if (parsed != null && parsed !== '') base = parsed
  } catch {
    // no config.toml or unreadable — fall back to default
  }
  const normalized = normalizeBase(base)
  const path = normalized.includes('/backend-api') ? USAGE_PATH : '/api/codex/usage'
  return normalized + path
}

async function loadAuth(): Promise<{ accessToken: string; accountId: string | null }> {
  const raw = await readFile(join(codexHome(), 'auth.json'), 'utf8')
  const parsed = JSON.parse(raw) as CodexAuthFile
  const accessToken = parsed.tokens?.access_token
  if (!(accessToken != null && accessToken !== '')) {
    throw new Error('no access_token in ~/.codex/auth.json — run `codex` to sign in')
  }
  return {
    accessToken,
    accountId: parsed.tokens?.account_id ?? null,
  }
}

function normalizePlanTier(raw: string | undefined | null): string | null {
  if (!(raw != null && raw !== '')) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()
  if (lower === 'pro') return 'Pro'
  if (lower === 'plus') return 'Plus'
  if (lower === 'free') return 'Free'
  if (lower === 'team') return 'Team'
  if (lower === 'business') return 'Business'
  if (lower === 'enterprise') return 'Enterprise'
  if (lower === 'edu' || lower === 'education') return 'Edu'
  if (lower === 'go') return 'Go'
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

function buildCodexWindow(
  kind: UsageWindowKind,
  label: string,
  window: WindowSnapshot | null | undefined,
  now: number
): UsageWindow | null {
  if (!window) return null
  const percent =
    typeof window.used_percent === 'number' ? Math.max(0, Math.min(100, window.used_percent)) : null
  const resetAtMs = window.reset_at != null && window.reset_at !== 0 ? window.reset_at * 1000 : null
  const resetAt = resetAtMs != null && resetAtMs !== 0 ? new Date(resetAtMs).toISOString() : null
  const windowSeconds =
    typeof window.limit_window_seconds === 'number' ? window.limit_window_seconds : null
  if (percent === null && !(resetAt != null && resetAt !== '')) return null
  return {
    kind,
    label,
    pace: computePace({ now, percent, resetAtMs, windowSeconds }),
    percent,
    resetAt,
    timeRemaining: formatTimeRemaining(resetAtMs, now),
    windowSeconds,
  }
}

function orderWindows(
  primary: WindowSnapshot | null | undefined,
  secondary: WindowSnapshot | null | undefined
): {
  session: WindowSnapshot | null | undefined
  weekly: WindowSnapshot | null | undefined
} {
  const SESSION_MIN_SECONDS = 3 * 3600
  const SESSION_MAX_SECONDS = 8 * 3600
  const isSession = (w: WindowSnapshot | null | undefined): boolean => {
    const s = w?.limit_window_seconds
    return typeof s === 'number' && s >= SESSION_MIN_SECONDS && s <= SESSION_MAX_SECONDS
  }
  if (isSession(primary)) return { session: primary, weekly: secondary }
  if (isSession(secondary)) return { session: secondary, weekly: primary }
  return { session: primary, weekly: secondary }
}

export async function fetchCodexUsage(_config: AIUsageToolConfig): Promise<UsageSnapshot> {
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
    tool: 'codex',
    windows: [],
  }

  try {
    const { accessToken, accountId } = await loadAuth()
    const url = await resolveUsageURL()

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent': 'aimux',
    }
    if (accountId != null && accountId !== '') headers['ChatGPT-Account-Id'] = accountId

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(url, { headers, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }

    if (response.status === 401 || response.status === 403) {
      return { ...base, error: 'codex oauth expired — run `codex` to re-auth' }
    }
    if (!response.ok) {
      return { ...base, error: `codex api ${response.status}` }
    }

    const parsed = (await response.json()) as CodexUsageResponse
    const planTier = normalizePlanTier(parsed.plan_type)
    const now = Date.now()
    const { session, weekly } = orderWindows(
      parsed.rate_limit?.primary_window,
      parsed.rate_limit?.secondary_window
    )

    const windows: UsageWindow[] = []
    const sessionWindow = buildCodexWindow('session', 'Session', session, now)
    if (sessionWindow) windows.push(sessionWindow)
    const weeklyWindow = buildCodexWindow('weekly', 'Weekly', weekly, now)
    if (weeklyWindow) windows.push(weeklyWindow)

    if (windows.length === 0) {
      return { ...base, error: 'no rate_limit data', planTier }
    }

    const summary = sessionWindow ?? weeklyWindow

    return {
      ...base,
      percent: summary?.percent ?? null,
      planTier,
      resetAt: summary?.resetAt ?? null,
      timeRemaining: summary?.timeRemaining ?? null,
      tool: 'codex',
      windows,
    }
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
