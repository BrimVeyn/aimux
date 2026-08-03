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

export const HISTORY_VERSION = 2
/** A file that exists but did not parse. Below every real version, so the save guard refuses it. */
const UNREADABLE_VERSION = -1
const ROLLUP_INTERVAL_MS = 20 * 60 * 60 * 1000

export interface UsageTokens {
  cacheRead: number
  cacheWrite: number
  input: number
  output: number
  total: number
}

/**
 * A running sum, its divisor and the largest sample. Enough for an average and a
 * record without keeping every sample — which is also why the pages that read
 * this say "average", never "median": the samples are gone.
 */
export interface UsageMean {
  count: number
  max: number
  sum: number
}

export interface UsageSession {
  /** ms epoch of the first prompt. */
  first: number
  /** ms epoch of the last prompt. */
  last: number
  prompts: number
}

export interface UsageDay {
  /** git branch -> tokens. Recent window only; Codex carries no branch. */
  branches: Record<string, number>
  /** 24 buckets, prompts per local hour. Empty on a v1 day. */
  hours: number[]
  /** model id -> tokens. Recent window only. */
  models: Record<string, number>
  /** Characters per prompt. Empty on a v1 day. */
  promptChars: UsageMean
  /** absolute project path -> prompts. Empty on a v1 day. */
  projects: Record<string, number>
  /** The only field with full-year coverage, and claude-only. */
  prompts: number
  /** sessionId -> span. Empty on a v1 day. */
  sessions: Record<string, UsageSession>
  tokens: UsageTokens
  /** Milliseconds between consecutive assistant turns. Empty on a v1 day. */
  turnMs: UsageMean
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

export const HOURS_IN_DAY = 24

export function emptyHours(): number[] {
  return Array.from({ length: HOURS_IN_DAY }, () => 0)
}

export function emptyMean(): UsageMean {
  return { count: 0, max: 0, sum: 0 }
}

export function emptyDay(): UsageDay {
  return {
    branches: {},
    hours: emptyHours(),
    models: {},
    projects: {},
    promptChars: emptyMean(),
    prompts: 0,
    sessions: {},
    tokens: emptyTokens(),
    turnMs: emptyMean(),
  }
}

/**
 * Fills in what a v1 day does not carry, so every reader sees one shape instead
 * of guarding each field. The filled-in values are empty rather than zeroed
 * measurements — a page that would render them as `0 min` has to check `count`
 * and say "no data" instead.
 */
function normalizeDay(day: UsageDay): UsageDay {
  const hours = Array.isArray(day.hours) && day.hours.length === HOURS_IN_DAY ? day.hours : null
  if (
    hours !== null &&
    day.projects != null &&
    day.sessions != null &&
    day.promptChars != null &&
    day.turnMs != null
  ) {
    return day
  }
  return {
    ...day,
    hours: hours ?? emptyHours(),
    projects: day.projects ?? {},
    promptChars: day.promptChars ?? emptyMean(),
    sessions: day.sessions ?? {},
    turnMs: day.turnMs ?? emptyMean(),
  }
}

function normalizeTools(tools: UsageTools): UsageTools {
  const normalized: UsageTools = {}
  for (const [tool, days] of Object.entries(tools) as [AIUsageTool, UsageDays][]) {
    const out: UsageDays = {}
    for (const [date, day] of Object.entries(days)) out[date] = normalizeDay(day)
    normalized[tool] = out
  }
  return normalized
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
    return { tools: normalizeTools(file.tools), version: file.version }
  } catch {
    return { tools: {}, version: UNREADABLE_VERSION }
  }
}

function mergeDay(stored: UsageDay, fresh: UsageDay): UsageDay {
  // Pruning only removes data, so a smaller fresh total means the stored copy is
  // the richer one. `>=` rather than `>` is what makes re-running converge.
  const keepFresh = fresh.tokens.total >= stored.tokens.total
  // Prompts merge separately: they outlive the transcripts the tokens came from.
  // Everything derived from `history.jsonl` follows the prompt count for the same
  // reason — that log is append-only, so it is never the pruned side.
  const keepFreshPrompts = fresh.prompts >= stored.prompts
  return {
    branches: keepFresh ? fresh.branches : stored.branches,
    hours: keepFreshPrompts ? fresh.hours : stored.hours,
    models: keepFresh ? fresh.models : stored.models,
    projects: keepFreshPrompts ? fresh.projects : stored.projects,
    promptChars: keepFreshPrompts ? fresh.promptChars : stored.promptChars,
    prompts: Math.max(fresh.prompts, stored.prompts),
    sessions: keepFreshPrompts ? fresh.sessions : stored.sessions,
    tokens: keepFresh ? fresh.tokens : stored.tokens,
    turnMs: keepFresh ? fresh.turnMs : stored.turnMs,
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

  // Two separate refusals, not one equality check. A newer aimux owns a shape
  // this build cannot round-trip, and an unreadable file may still hold years
  // this rollup can no longer see — neither gets written over. An *older* file
  // is the one case that is safe: this build reads v1 and writes it back as v2,
  // which is how the upgrade happens at all.
  if (stored.version > HISTORY_VERSION || stored.version < 1) {
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
