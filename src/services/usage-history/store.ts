import type { AIUsageTool } from '@brimveyn/aimux-config'

import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { logDebug } from '../../debug/input-log'
import { spawnDetachedCommand } from '../../platform/daemon-control'

/**
 * Long-term AI usage, per local calendar day.
 *
 * Claude Code prunes its transcripts after about a month, so this is not a cache
 * of something re-derivable: once a day is pruned, this file is the only place
 * its numbers still exist. Hence the refusal to overwrite anything it cannot
 * fully round-trip.
 */

export const HISTORY_VERSION = 1
/** A file that exists but did not parse. Never equal to HISTORY_VERSION, so the save guard refuses it. */
const UNREADABLE_VERSION = -1
const ROLLUP_INTERVAL_MS = 20 * 60 * 60 * 1000

export interface UsageTokens {
  cacheRead: number
  cacheWrite: number
  input: number
  output: number
  total: number
}

export interface UsageDay {
  /** git branch -> tokens. Recent window only; Codex carries no branch. */
  branches: Record<string, number>
  /** model id -> tokens. Recent window only. */
  models: Record<string, number>
  /** The only field with full-year coverage, and claude-only. */
  prompts: number
  tokens: UsageTokens
}

/** 'YYYY-MM-DD' in the machine's local calendar -> that day's usage. */
export type UsageDays = Record<string, UsageDay>

/** The key format above — `toISOString()` would shift every evening east of Greenwich by one. */
export function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export type UsageTools = Partial<Record<AIUsageTool, UsageDays>>

export interface UsageHistoryFile {
  tools: UsageTools
  version: number
}

export function emptyTokens(): UsageTokens {
  return { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 }
}

export function emptyDay(): UsageDay {
  return { branches: {}, models: {}, prompts: 0, tokens: emptyTokens() }
}

/** Resolved per call, not at module scope, so a `HOME` override in tests reaches it. */
export function usageHistoryPath(): string {
  const home = process.env.HOME ?? homedir()
  return join(home, '.config', 'aimux', 'usage-history.json')
}

export function readUsageHistory(): UsageHistoryFile {
  let raw: string
  try {
    raw = readFileSync(usageHistoryPath(), 'utf8')
  } catch {
    return { tools: {}, version: HISTORY_VERSION } // no file yet; safe to create
  }

  try {
    const file = JSON.parse(raw) as Partial<UsageHistoryFile>
    if (typeof file.version !== 'number') return { tools: {}, version: UNREADABLE_VERSION }
    if (typeof file.tools !== 'object' || file.tools === null) {
      return { tools: {}, version: UNREADABLE_VERSION }
    }
    return { tools: file.tools, version: file.version }
  } catch {
    return { tools: {}, version: UNREADABLE_VERSION }
  }
}

function mergeDay(stored: UsageDay, fresh: UsageDay): UsageDay {
  // Pruning only removes data, so a smaller fresh total means the stored copy is
  // the richer one. `>=` rather than `>` is what makes re-running converge.
  const keepFresh = fresh.tokens.total >= stored.tokens.total
  // Prompts merge separately: they outlive the transcripts the tokens came from.
  return {
    branches: keepFresh ? fresh.branches : stored.branches,
    models: keepFresh ? fresh.models : stored.models,
    prompts: Math.max(fresh.prompts, stored.prompts),
    tokens: keepFresh ? fresh.tokens : stored.tokens,
  }
}

/** Replacement per day, never accumulation — adding would double every total per rollup. */
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

/** False when nothing was written, which leaves the mtime alone so the next launch retries. */
export function saveUsageHistory(fresh: UsageTools): boolean {
  const stored = readUsageHistory()

  // A newer aimux owns a shape this build cannot round-trip; an unreadable file
  // may still hold years this rollup can no longer see. Neither gets written over.
  if (stored.version !== HISTORY_VERSION) {
    logDebug('usageHistory.refusedWrite', { version: stored.version })
    return false
  }

  const path = usageHistoryPath()
  const file: UsageHistoryFile = {
    tools: mergeUsageHistory(stored.tools, fresh),
    version: HISTORY_VERSION,
  }

  try {
    mkdirSync(dirname(path), { recursive: true })
    // pid-suffixed: two launches can roll up at once, and a shared tmp name would
    // let one truncate the other's half-written file.
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
 * Detached because the parse is a second of CPU over hundreds of MB of JSONL.
 * 20h rather than 24h so opening aimux at the same time each morning does not
 * land exactly on the boundary and skip every other day.
 */
export function maybeSpawnUsageRollup(): void {
  try {
    if (process.env.AIMUX_NO_USAGE_ROLLUP === '1') return
    // mtime is the last successful rollup: the file is written on success and
    // nothing else. Beats parsing an ever-growing JSON on the startup path.
    const rolledUpAt = statSync(usageHistoryPath(), { throwIfNoEntry: false })?.mtimeMs ?? 0
    if (Date.now() - rolledUpAt < ROLLUP_INTERVAL_MS) return
    spawnDetachedCommand('usage-rollup')
  } catch (error) {
    logDebug('usageHistory.spawnError', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
