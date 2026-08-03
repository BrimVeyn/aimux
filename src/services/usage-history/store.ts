import type { AIUsageTool } from '@brimveyn/aimux-config'

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { logDebug } from '../../debug/input-log'

/**
 * Long-term record of AI usage, aggregated per local calendar day.
 *
 * Claude Code prunes its own transcripts — roughly a month survives on disk —
 * and the `stats-cache.json` it used to keep alongside them stopped being
 * written in February 2026. So this file is not a cache of something we could
 * re-derive: once a day's transcripts are pruned, this is the only place that
 * day's numbers still exist. Everything here is written with that in mind.
 */

export const HISTORY_VERSION = 1

const ROLLUP_INTERVAL_MS = 20 * 60 * 60 * 1000

export interface UsageTokens {
  cacheRead: number
  cacheWrite: number
  input: number
  output: number
  total: number
}

export interface UsageDay {
  /** git branch -> tokens. Recent window only; Codex transcripts carry no branch. */
  branches: Record<string, number>
  /** model id -> tokens. Recent window only, for the same reason. */
  models: Record<string, number>
  /** Prompts submitted. The only field with full-year coverage, and claude-only. */
  prompts: number
  tokens: UsageTokens
}

/** 'YYYY-MM-DD' in the machine's local calendar -> that day's usage. */
export type UsageDays = Record<string, UsageDay>

export type UsageTools = Partial<Record<AIUsageTool, UsageDays>>

export interface UsageHistoryFile {
  lastRollupAt: number
  tools: UsageTools
  version: number
}

export function emptyTokens(): UsageTokens {
  return { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 }
}

export function emptyDay(): UsageDay {
  return { branches: {}, models: {}, prompts: 0, tokens: emptyTokens() }
}

/**
 * Resolved per call rather than at module scope: a module-level const freezes
 * the path at import time, which makes the whole store untestable through a
 * `HOME` override (see `services/ai-usage/cache.ts`, which has that problem).
 */
export function usageHistoryPath(): string {
  // `getConfigProfilesRootDir()` falls back to a literal '~' when HOME is unset,
  // which would create an actual `./~/.config/aimux` directory. Tolerable for a
  // marker file, not for the one copy of data nothing can regenerate.
  const home = process.env.HOME ?? homedir()
  return join(home, '.config', 'aimux', 'usage-history.json')
}

function emptyHistory(): UsageHistoryFile {
  return { lastRollupAt: 0, tools: {}, version: HISTORY_VERSION }
}

export function readUsageHistory(): UsageHistoryFile {
  try {
    const parsed = JSON.parse(readFileSync(usageHistoryPath(), 'utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null) return emptyHistory()
    const file = parsed as Partial<UsageHistoryFile>
    if (typeof file.version !== 'number') return emptyHistory()
    if (typeof file.tools !== 'object' || file.tools === null) return emptyHistory()
    return {
      lastRollupAt: typeof file.lastRollupAt === 'number' ? file.lastRollupAt : 0,
      tools: file.tools,
      version: file.version,
    }
  } catch {
    return emptyHistory()
  }
}

function mergeDay(stored: UsageDay, fresh: UsageDay): UsageDay {
  // Pruning only ever REMOVES data, never adds it. A fresh total smaller than
  // the stored one therefore means the source was pruned between two rollups,
  // and the stored value is the richer of the two. `>=` rather than `>` is what
  // makes re-running a rollup over an unchanged day a no-op — with `>`, an
  // identical re-parse would be discarded and the two would never converge.
  const keepFresh = fresh.tokens.total >= stored.tokens.total

  // Tokens and prompts come from sources with different retention: a day old
  // enough to have lost its transcripts still has its prompts in history.jsonl.
  // Merging the whole record on the token comparison alone would throw away a
  // fresher prompt count every time.
  return {
    branches: keepFresh ? fresh.branches : stored.branches,
    models: keepFresh ? fresh.models : stored.models,
    prompts: Math.max(fresh.prompts, stored.prompts),
    tokens: keepFresh ? fresh.tokens : stored.tokens,
  }
}

/**
 * Days present only in `stored` survive untouched — that is the entire point of
 * the file. Replacement, never accumulation: adding the two would double every
 * total on each rollup.
 */
export function mergeUsageHistory(stored: UsageTools, fresh: UsageTools): UsageTools {
  const merged: UsageTools = { ...stored }

  for (const [tool, freshDays] of Object.entries(fresh) as [AIUsageTool, UsageDays][]) {
    const storedDays = stored[tool] ?? {}
    const days: UsageDays = { ...storedDays }
    for (const [date, freshDay] of Object.entries(freshDays)) {
      const storedDay = storedDays[date]
      days[date] = storedDay === undefined ? freshDay : mergeDay(storedDay, freshDay)
    }
    merged[tool] = days
  }

  return merged
}

/**
 * Returns false when nothing was written. The caller treats that as a failed
 * rollup and leaves `lastRollupAt` alone so the next launch retries.
 */
export function saveUsageHistory(fresh: UsageTools, now: number): boolean {
  const stored = readUsageHistory()

  // A newer aimux (a dev build sharing the same HOME) owns a shape this one
  // cannot round-trip. Reading it to render is harmless; writing it back would
  // silently drop every field this version does not know about.
  if (stored.version !== HISTORY_VERSION) {
    logDebug('usageHistory.foreignVersion', { version: stored.version })
    return false
  }

  const path = usageHistoryPath()
  const file: UsageHistoryFile = {
    lastRollupAt: now,
    tools: mergeUsageHistory(stored.tools, fresh),
    version: HISTORY_VERSION,
  }

  try {
    mkdirSync(dirname(path), { recursive: true })
    // pid-suffixed: two aimux launches can roll up concurrently, and a shared
    // tmp name would let one truncate the other's half-written file.
    const tmpPath = `${path}.${process.pid}.tmp`
    writeFileSync(tmpPath, `${JSON.stringify(file, null, 2)}\n`)
    renameSync(tmpPath, path)
    return true
  } catch (error) {
    logDebug('usageHistory.writeError', {
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/**
 * Spawns the rollup as a detached process, at most once per ~day.
 *
 * Detached because the parse is a second of solid CPU over hundreds of
 * megabytes of JSONL — in-process it would stall the render loop, and nothing
 * else in this app does sustained CPU work on the main thread.
 *
 * 20h rather than 24h: someone who opens aimux every morning at roughly the
 * same time sits exactly on a 24h boundary and would skip every other day.
 */
export function maybeSpawnUsageRollup(): void {
  try {
    if (process.env.AIMUX_NO_USAGE_ROLLUP === '1') return
    const { lastRollupAt } = readUsageHistory()
    if (Date.now() - lastRollupAt < ROLLUP_INTERVAL_MS) return

    const entryPoint = resolve(import.meta.dir, '..', '..', 'index.tsx')
    Bun.spawn([process.execPath, 'run', entryPoint, 'usage-rollup'], {
      detached: true,
      stderr: 'ignore',
      stdin: 'ignore',
      stdout: 'ignore',
    }).unref()
  } catch (error) {
    // Never let a stats rollup keep the app from starting.
    logDebug('usageHistory.spawnError', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
