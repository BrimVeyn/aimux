import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { logDebug } from '../../debug/input-log'
import { codexHome } from '../ai-usage/adapters/codex'
import { emptyDay, saveUsageHistory, type UsageDay, type UsageDays, type UsageTools } from './store'

/**
 * Rebuilds the usage aggregates from whatever the assistants still have on
 * disk, and merges them into the long-term store.
 *
 * Runs as its own process (`aimux usage-rollup`, spawned detached from
 * `maybeSpawnUsageRollup`). Nothing in here may be imported from the startup
 * path: it walks hundreds of megabytes of JSONL.
 */

const FILE_CONCURRENCY = 8

function claudeHome(): string {
  const env = process.env.CLAUDE_CONFIG_DIR?.trim()
  if (env != null && env !== '') return env
  return join(homedir(), '.claude')
}

/**
 * Local calendar day. `toISOString().slice(0, 10)` would bucket everything after
 * midnight UTC into tomorrow, which for anyone east of Greenwich shifts every
 * evening of the year one cell to the right.
 */
export function localDay(ms: number): string {
  const date = new Date(ms)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function dayAt(days: UsageDays, date: string): UsageDay {
  const existing = days[date]
  if (existing !== undefined) return existing
  const created = emptyDay()
  days[date] = created
  return created
}

function bump(counts: Record<string, number>, key: string, amount: number): void {
  counts[key] = (counts[key] ?? 0) + amount
}

/**
 * Every line of a JSONL file, streamed.
 *
 * The largest Claude transcript on a working machine is ~90 MB, and
 * `Bun.file().text()` materializes the whole thing plus its UTF-16 copy before
 * the first line can even be looked at.
 */
export async function readJsonlLines(path: string, onLine: (line: string) => void): Promise<void> {
  const decoder = new TextDecoder()
  let carry = ''

  for await (const chunk of Bun.file(path).stream()) {
    // `stream: true` holds back a trailing partial UTF-8 sequence instead of
    // replacing it with U+FFFD. Without it, any multi-byte character landing on
    // a chunk boundary corrupts its line and JSON.parse throws on it.
    const parts = (carry + decoder.decode(chunk, { stream: true })).split('\n')
    carry = parts.pop() ?? ''
    for (const line of parts) onLine(line)
  }

  carry += decoder.decode()
  // Files with no trailing newline, and files an assistant is appending to right
  // now — the latter's last line is half-written and simply fails JSON.parse.
  if (carry !== '') onLine(carry)
}

function findJsonl(root: string): string[] {
  try {
    // Recursive: transcript directories nest at varying depths, and a flat
    // readdir silently misses close to half the corpus.
    return readdirSync(root, { recursive: true })
      .filter((entry): entry is string => typeof entry === 'string' && entry.endsWith('.jsonl'))
      .map((entry) => join(root, entry))
  } catch {
    return [] // assistant not installed on this machine
  }
}

async function forEachFile(paths: string[], run: (path: string) => Promise<void>): Promise<void> {
  let cursor = 0
  // `cursor++` needs no lock: there is no await between the read and the
  // increment, and JS is single-threaded, so no two workers see the same index.
  const workers = Array.from({ length: Math.min(FILE_CONCURRENCY, paths.length) }, async () => {
    while (cursor < paths.length) {
      const path = paths[cursor++]
      if (path === undefined) return
      try {
        await run(path)
      } catch {
        // One unreadable transcript must never sink the whole rollup.
      }
    }
  })
  await Promise.all(workers)
}

interface TranscriptUsage {
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  input_tokens?: number
  output_tokens?: number
}

interface TranscriptLine {
  gitBranch?: string
  message?: { id?: string; model?: string; usage?: TranscriptUsage }
  requestId?: string
  timestamp?: string
}

/**
 * One line of a Claude Code transcript.
 *
 * `seen` spans the whole run on purpose: Claude Code copies earlier turns into a
 * fresh transcript on resume or fork, and compaction re-emits them, so the same
 * billed request shows up in several files.
 */
export function consumeTranscriptLine(line: string, seen: Set<string>, days: UsageDays): void {
  // Only ~23k of ~126k lines carry usage, and the rest include base64 thinking
  // signatures hundreds of KB long. Rejecting them on a substring beats parsing.
  if (!line.includes('"output_tokens"')) return

  let entry: TranscriptLine
  try {
    entry = JSON.parse(line) as TranscriptLine
  } catch {
    return
  }

  const usage = entry.message?.usage
  if (usage === undefined || entry.timestamp == null) return

  // Placeholder assistant messages (API errors, interrupted turns) carry junk
  // usage under this model id.
  const model = entry.message?.model
  if (model === '<synthetic>') return

  const id = entry.message?.id
  const { requestId } = entry
  // Only dedupe when both halves are present: without an id we cannot prove a
  // duplicate, and for a stats page undercounting is worse than a rare double.
  if (id != null && id !== '' && requestId != null && requestId !== '') {
    const key = `${id}:${requestId}`
    if (seen.has(key)) return
    seen.add(key)
  }

  const ms = Date.parse(entry.timestamp)
  if (!Number.isFinite(ms)) return

  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const input = usage.input_tokens ?? 0
  const output = usage.output_tokens ?? 0
  const total = input + output + cacheRead + cacheWrite
  if (total <= 0) return

  const day = dayAt(days, localDay(ms))
  day.tokens.cacheRead += cacheRead
  day.tokens.cacheWrite += cacheWrite
  day.tokens.input += input
  day.tokens.output += output
  day.tokens.total += total

  if (model != null && model !== '') bump(day.models, model, total)
  const branch = entry.gitBranch
  if (branch != null && branch !== '') bump(day.branches, branch, total)
}

/**
 * One line of `history.jsonl` — the prompt log. It is the only source that
 * survives transcript pruning, so it alone covers the full year.
 */
export function consumeHistoryLine(line: string, days: UsageDays): void {
  if (!line.includes('"timestamp"')) return

  let entry: { timestamp?: number | string }
  try {
    entry = JSON.parse(line) as { timestamp?: number | string }
  } catch {
    return
  }

  // Stored as a number today, but Claude Code has shipped it quoted before.
  // `Number()` covers both, where `new Date(raw)` on the quoted form returns
  // Invalid Date and silently drops the entry.
  const ms = Number(entry.timestamp)
  if (!Number.isFinite(ms) || ms <= 0) return

  dayAt(days, localDay(ms)).prompts += 1
}

interface CodexLine {
  payload?: {
    info?: {
      last_token_usage?: {
        cached_input_tokens?: number
        input_tokens?: number
        output_tokens?: number
        total_tokens?: number
      }
    }
    model?: string
  }
  timestamp?: string
}

export interface CodexFileState {
  model: string | null
}

/**
 * One line of a Codex rollout file.
 *
 * `last_token_usage` is the per-turn delta; the sibling `total_token_usage` is
 * cumulative over the session, so summing that one would overcount by n²/2.
 */
export function consumeCodexLine(line: string, state: CodexFileState, days: UsageDays): void {
  if (!line.includes('"model"') && !line.includes('"last_token_usage"')) return

  let entry: CodexLine
  try {
    entry = JSON.parse(line) as CodexLine
  } catch {
    return
  }

  const model = entry.payload?.model
  if (model != null && model !== '') state.model = model

  const usage = entry.payload?.info?.last_token_usage
  if (usage === undefined || entry.timestamp == null) return

  const ms = Date.parse(entry.timestamp)
  if (!Number.isFinite(ms)) return

  const cacheRead = usage.cached_input_tokens ?? 0
  const total = usage.total_tokens ?? 0
  if (total <= 0) return

  const day = dayAt(days, localDay(ms))
  day.tokens.cacheRead += cacheRead
  // cached_input_tokens ⊂ input_tokens and reasoning_output_tokens ⊂
  // output_tokens, so the cached share is subtracted rather than added on top.
  day.tokens.input += Math.max(0, (usage.input_tokens ?? 0) - cacheRead)
  day.tokens.output += usage.output_tokens ?? 0
  day.tokens.total += total

  if (state.model != null && state.model !== '') bump(day.models, state.model, total)
}

async function collectClaude(): Promise<UsageDays> {
  const days: UsageDays = {}
  const seen = new Set<string>()
  const root = claudeHome()

  await forEachFile(findJsonl(join(root, 'projects')), async (path) => {
    await readJsonlLines(path, (line) => {
      consumeTranscriptLine(line, seen, days)
    })
  })

  try {
    await readJsonlLines(join(root, 'history.jsonl'), (line) => {
      consumeHistoryLine(line, days)
    })
  } catch {
    // No prompt log: the heatmap falls back to whatever the transcripts cover.
  }

  return days
}

async function collectCodex(): Promise<UsageDays> {
  const days: UsageDays = {}

  await forEachFile(findJsonl(join(codexHome(), 'sessions')), async (path) => {
    const state: CodexFileState = { model: null }
    await readJsonlLines(path, (line) => {
      consumeCodexLine(line, state, days)
    })
  })

  return days
}

export async function runUsageRollup(): Promise<number> {
  try {
    const [claude, codex] = await Promise.all([collectClaude(), collectCodex()])

    const fresh: UsageTools = {}
    if (Object.keys(claude).length > 0) fresh.claude = claude
    if (Object.keys(codex).length > 0) fresh.codex = codex

    // Nothing parsed at all means every source was missing or unreadable.
    // Writing that would stamp lastRollupAt and skip retrying for a day.
    if (Object.keys(fresh).length === 0) {
      logDebug('usageHistory.rollupEmpty', {})
      return 1
    }

    return saveUsageHistory(fresh, Date.now()) ? 0 : 1
  } catch (error) {
    logDebug('usageHistory.rollupError', {
      error: error instanceof Error ? error.message : String(error),
    })
    return 1
  }
}
