import type { AIUsageToolConfig } from '@brimveyn/aimux-config'

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { UsageSnapshot } from '../types'

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

function codexHome(): string {
  const env = process.env.CODEX_HOME?.trim()
  if (env) return env
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
    if (parsed) base = parsed
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
  if (!accessToken) {
    throw new Error('no access_token in ~/.codex/auth.json — run `codex` to sign in')
  }
  return {
    accessToken,
    accountId: parsed.tokens?.account_id ?? null,
  }
}

function formatRemainingFromReset(resetAtSeconds: number | undefined): string | null {
  if (!resetAtSeconds) return null
  const diffMs = resetAtSeconds * 1000 - Date.now()
  if (diffMs <= 0) return null
  const totalMin = Math.round(diffMs / 60_000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}h`
}

function pickPrimaryWindow(rate: CodexUsageResponse['rate_limit']): WindowSnapshot | null {
  if (!rate) return null
  // Primary = 5h session window. Pick the one closest to 300 minutes (18000s),
  // falling back to whichever is defined.
  const windows = [rate.primary_window, rate.secondary_window].filter(
    (w): w is WindowSnapshot => !!w
  )
  if (windows.length === 0) return null
  const sessionWindow = windows.find((w) => w.limit_window_seconds === 18_000)
  return sessionWindow ?? windows[0] ?? null
}

export async function fetchCodexUsage(_config: AIUsageToolConfig): Promise<UsageSnapshot> {
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
    const { accessToken, accountId } = await loadAuth()
    const url = await resolveUsageURL()

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent': 'aimux',
    }
    if (accountId) headers['ChatGPT-Account-Id'] = accountId

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
    const window = pickPrimaryWindow(parsed.rate_limit)
    if (!window) {
      return { ...base, error: 'no rate_limit data' }
    }

    const percent =
      typeof window.used_percent === 'number'
        ? Math.max(0, Math.min(100, window.used_percent))
        : null
    const resetAt = window.reset_at ? new Date(window.reset_at * 1000).toISOString() : null

    return {
      ...base,
      percent,
      resetAt,
      timeRemaining: formatRemainingFromReset(window.reset_at),
      tool: 'codex',
    }
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
