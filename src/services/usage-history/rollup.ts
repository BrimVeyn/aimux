import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { logDebug } from '../../debug/input-log'
import { claudeHome, codexHome } from '../../platform/assistant-home'
import {
  emptyDay,
  localDay,
  saveUsageHistory,
  type UsageDay,
  type UsageDays,
  type UsageTools,
} from './store'

/**
 * Rebuilds the usage aggregates from what the assistants still have on disk.
 *
 * Its own process (`aimux usage-rollup`). Nothing here may be imported from the
 * startup path: it walks hundreds of megabytes of JSONL.
 */

const FILE_CONCURRENCY = 8

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

/** Streamed: the largest transcript here is ~90 MB, which `Bun.file().text()` would materialize whole. */
export async function readJsonlLines(path: string, onLine: (line: string) => void): Promise<void> {
  const decoder = new TextDecoder()
  let carry = ''

  for await (const chunk of Bun.file(path).stream()) {
    // `stream: true` holds back a partial UTF-8 sequence at the chunk edge
    // instead of replacing it with U+FFFD and corrupting the line.
    const parts = (carry + decoder.decode(chunk, { stream: true })).split('\n')
    carry = parts.pop() ?? ''
    for (const line of parts) onLine(line)
  }

  carry += decoder.decode()
  // No trailing newline, or a file being appended to right now — the half-written
  // last line just fails JSON.parse downstream.
  if (carry !== '') onLine(carry)
}

function findJsonl(root: string): string[] {
  try {
    // Recursive: transcripts nest at varying depths and a flat readdir misses half.
    return readdirSync(root, { recursive: true })
      .filter((entry): entry is string => typeof entry === 'string' && entry.endsWith('.jsonl'))
      .map((entry) => join(root, entry))
  } catch {
    return [] // assistant not installed on this machine
  }
}

async function forEachFile(paths: string[], run: (path: string) => Promise<void>): Promise<void> {
  let cursor = 0
  // `cursor++` needs no lock: no await between read and increment, single thread.
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

/** `seen` spans the whole run: resume, fork and compaction re-emit the same billed request across files. */
export function consumeTranscriptLine(line: string, seen: Set<string>, days: UsageDays): void {
  // ~23k of ~126k lines carry usage; the rest hold base64 thinking blobs. A
  // substring test beats parsing them.
  if (!line.includes('"output_tokens"')) return

  let entry: TranscriptLine
  try {
    entry = JSON.parse(line) as TranscriptLine
  } catch {
    return
  }

  const usage = entry.message?.usage
  if (usage === undefined || entry.timestamp == null) return

  // Placeholder messages (API errors, interrupted turns) carry junk usage.
  const model = entry.message?.model
  if (model === '<synthetic>') return

  const id = entry.message?.id
  const { requestId } = entry
  // Both halves or nothing: without an id a duplicate cannot be proven, and
  // undercounting a stats page is worse than a rare double.
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

  const day = dayAt(days, localDay(new Date(ms)))
  day.tokens.cacheRead += cacheRead
  day.tokens.cacheWrite += cacheWrite
  day.tokens.input += input
  day.tokens.output += output
  day.tokens.total += total

  if (model != null && model !== '') bump(day.models, model, total)
  const branch = entry.gitBranch
  if (branch != null && branch !== '') bump(day.branches, branch, total)
}

/** `history.jsonl`, the prompt log — the only source that survives transcript pruning. */
export function consumeHistoryLine(line: string, days: UsageDays): void {
  if (!line.includes('"timestamp"')) return

  let entry: { timestamp?: number | string }
  try {
    entry = JSON.parse(line) as { timestamp?: number | string }
  } catch {
    return
  }

  // A number today, quoted in past releases. `Number()` covers both, where
  // `new Date(quoted)` returns Invalid Date and drops the entry.
  const ms = Number(entry.timestamp)
  if (!Number.isFinite(ms) || ms <= 0) return

  dayAt(days, localDay(new Date(ms))).prompts += 1
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

/** `last_token_usage` is the per-turn delta; the sibling `total_token_usage` is cumulative — summing it overcounts by n²/2. */
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

  const day = dayAt(days, localDay(new Date(ms)))
  day.tokens.cacheRead += cacheRead
  // cached_input_tokens ⊂ input_tokens, so the cached share is subtracted not added.
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

    // Nothing parsed means every source was missing. Writing would bump the
    // mtime, which schedules the next run, and buy a day of not retrying.
    if (Object.keys(fresh).length === 0) {
      logDebug('usageHistory.rollupEmpty', {})
      return 1
    }

    return saveUsageHistory(fresh) ? 0 : 1
  } catch (error) {
    logDebug('usageHistory.rollupError', {
      error: error instanceof Error ? error.message : String(error),
    })
    return 1
  }
}
