import { readJsonlLines } from './rollup'

/**
 * One conversation's token usage, read from its transcript.
 *
 * The rollup in `rollup.ts` folds every transcript into calendar days for the
 * stats screen. A plugin watching *one agent* — a token dashboard beside it,
 * a handoff when the context gets long, a nudge near the limit — wants the
 * opposite cut: this session, cumulative, now. Same line filter and the same
 * de-duplication rule (resume and compaction re-emit billed messages), with
 * the days left out.
 */
export interface SessionUsageTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  turns: number
  models: Record<string, number>
  lastAt: string | null
}

interface TranscriptUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

interface TranscriptLine {
  message?: { id?: string; model?: string; usage?: TranscriptUsage }
  requestId?: string
  timestamp?: string
}

export function emptySessionUsage(): SessionUsageTotals {
  return {
    cacheRead: 0,
    cacheWrite: 0,
    input: 0,
    lastAt: null,
    models: {},
    output: 0,
    total: 0,
    turns: 0,
  }
}

/** Folds one transcript line in. Exported so the parser can be tested without a file. */
export function consumeSessionLine(
  line: string,
  seen: Set<string>,
  totals: SessionUsageTotals
): void {
  if (!line.includes('"output_tokens"')) return
  let entry: TranscriptLine
  try {
    entry = JSON.parse(line) as TranscriptLine
  } catch {
    return
  }
  const usage = entry.message?.usage
  if (usage === undefined) return
  const model = entry.message?.model
  if (model === '<synthetic>') return

  const id = entry.message?.id
  const { requestId } = entry
  if (id != null && id !== '' && requestId != null && requestId !== '') {
    const key = `${id}:${requestId}`
    if (seen.has(key)) return
    seen.add(key)
  }

  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const input = usage.input_tokens ?? 0
  const output = usage.output_tokens ?? 0
  const total = input + output + cacheRead + cacheWrite
  if (total <= 0) return

  totals.cacheRead += cacheRead
  totals.cacheWrite += cacheWrite
  totals.input += input
  totals.output += output
  totals.total += total
  totals.turns += 1
  if (model != null && model !== '') {
    totals.models[model] = (totals.models[model] ?? 0) + total
  }
  if (entry.timestamp != null && entry.timestamp !== '') totals.lastAt = entry.timestamp
}

/** Zero everywhere for a missing file: no transcript yet is not an error. */
export async function readSessionUsage(transcriptPath: string): Promise<SessionUsageTotals> {
  const totals = emptySessionUsage()
  const seen = new Set<string>()
  try {
    await readJsonlLines(transcriptPath, (line) => {
      consumeSessionLine(line, seen, totals)
    })
  } catch {
    return totals
  }
  return totals
}
