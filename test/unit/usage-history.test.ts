import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  consumeHistoryLine,
  consumeTranscriptLine,
  readJsonlLines,
} from '../../src/services/usage-history/rollup'
import {
  buildHeatmap,
  coveredWeeks,
  mixColor,
  monthRuler,
  summarizeDays,
} from '../../src/services/usage-history/stats'
import {
  HISTORY_VERSION,
  localDay,
  mergeUsageHistory,
  readUsageHistory,
  saveUsageHistory,
  type UsageDay,
  type UsageDays,
  usageHistoryPath,
  type UsageTools,
} from '../../src/services/usage-history/store'

const originalHome = process.env.HOME
const dirs: string[] = []

/**
 * Points HOME at a scratch dir and returns the path the production resolver
 * picks. Never assemble that path by hand — the resolver is what the code under
 * test calls, and a guessed path silently tests nothing.
 */
function withHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'aimux-usage-history-'))
  dirs.push(home)
  process.env.HOME = home
  return usageHistoryPath()
}

function tempFile(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'aimux-usage-jsonl-'))
  dirs.push(dir)
  const path = join(dir, name)
  writeFileSync(path, contents)
  return path
}

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

function day(prompts: number, total: number, extra?: Partial<UsageDay>): UsageDay {
  return {
    branches: { main: total },
    models: { 'claude-opus-5': total },
    prompts,
    tokens: { cacheRead: 0, cacheWrite: 0, input: total, output: 0, total },
    ...extra,
  }
}

async function collectLines(path: string): Promise<string[]> {
  const lines: string[] = []
  await readJsonlLines(path, (line) => {
    lines.push(line)
  })
  return lines
}

describe('mergeUsageHistory', () => {
  test('merging the same fresh rollup twice changes nothing the second time', () => {
    const stored: UsageTools = { claude: { '2026-03-01': day(10, 500) } }
    const fresh: UsageTools = { claude: { '2026-03-01': day(12, 900) } }

    const once = mergeUsageHistory(stored, fresh)
    const twice = mergeUsageHistory(once, fresh)

    expect(twice).toEqual(once)
    // `>=` rather than `>` is what buys this: with `>`, an identical re-parse
    // would lose to the stored copy and the two would never converge.
    expect(once.claude?.['2026-03-01']?.tokens.total).toBe(900)
  })

  test('a pruned day keeps its stored tokens but takes the fresher prompt count', () => {
    const stored: UsageTools = { claude: { '2026-01-20': day(40, 1000) } }
    const fresh: UsageTools = { claude: { '2026-01-20': day(50, 300) } }

    const merged = mergeUsageHistory(stored, fresh).claude?.['2026-01-20']

    // Transcripts were pruned between rollups, so the smaller fresh total is the
    // impoverished one. Prompts come from history.jsonl, which outlives them.
    expect(merged?.tokens.total).toBe(1000)
    expect(merged?.prompts).toBe(50)
  })

  test('a day the fresh rollup never saw survives untouched', () => {
    const old = day(31, 777)
    const stored: UsageTools = { claude: { '2026-01-13': old } }
    const fresh: UsageTools = { claude: { '2026-08-03': day(5, 10) } }

    const merged = mergeUsageHistory(stored, fresh)

    // The whole reason the file exists: it is the only remaining record of days
    // whose transcripts are long gone.
    expect(merged.claude?.['2026-01-13']).toEqual(old)
    expect(merged.claude?.['2026-08-03']?.prompts).toBe(5)
  })

  test('a tool absent from the fresh rollup is not dropped', () => {
    const stored: UsageTools = { codex: { '2026-02-02': day(0, 42) } }
    const merged = mergeUsageHistory(stored, { claude: { '2026-02-02': day(1, 1) } })

    expect(merged.codex?.['2026-02-02']?.tokens.total).toBe(42)
  })
})

describe('readJsonlLines', () => {
  test('yields the last line of a file with no trailing newline', async () => {
    const path = tempFile('tail.jsonl', '{"a":1}\n{"b":2}')
    expect(await collectLines(path)).toEqual(['{"a":1}', '{"b":2}'])
  })

  test('a line longer than one stream chunk round-trips intact', async () => {
    const pad = 'x'.repeat(200_000)
    const path = tempFile('long.jsonl', `${JSON.stringify({ pad })}\n{"after":true}\n`)

    const lines = await collectLines(path)

    expect(lines).toHaveLength(2)
    expect((JSON.parse(lines[0] ?? '') as { pad: string }).pad).toHaveLength(200_000)
    expect(lines[1]).toBe('{"after":true}')
  })

  test('multi-byte characters straddling chunk boundaries are not corrupted', async () => {
    // 200 KB of two-byte characters guarantees several land across a boundary.
    // Without `decode(chunk, { stream: true })` those become U+FFFD and the line
    // stops being valid JSON.
    const pad = 'é'.repeat(100_000)
    const path = tempFile('utf8.jsonl', `${JSON.stringify({ pad })}\n`)

    const lines = await collectLines(path)

    expect(lines).toHaveLength(1)
    expect((JSON.parse(lines[0] ?? '') as { pad: string }).pad).toBe(pad)
  })
})

describe('consumeTranscriptLine', () => {
  const usage = {
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    input_tokens: 100,
    output_tokens: 20,
  }

  function transcript(overrides: Record<string, unknown>): string {
    return JSON.stringify({
      gitBranch: 'main',
      message: { id: 'msg_1', model: 'claude-opus-5', usage },
      requestId: 'req_1',
      timestamp: '2026-03-05T10:00:00.000Z',
      ...overrides,
    })
  }

  test('the same message id and request id is counted once', () => {
    const days: UsageDays = {}
    const seen = new Set<string>()
    const line = transcript({})

    consumeTranscriptLine(line, seen, days)
    consumeTranscriptLine(line, seen, days)

    // Claude Code copies earlier turns into a new transcript on resume, so the
    // same billed request genuinely appears in several files.
    expect(summarizeDays(days).tokens.total).toBe(120)
  })

  test('a different request id is a different billed request', () => {
    const days: UsageDays = {}
    const seen = new Set<string>()

    consumeTranscriptLine(transcript({}), seen, days)
    consumeTranscriptLine(transcript({ requestId: 'req_2' }), seen, days)

    expect(summarizeDays(days).tokens.total).toBe(240)
  })

  test('synthetic assistant messages contribute nothing', () => {
    const days: UsageDays = {}
    consumeTranscriptLine(
      transcript({ message: { id: 'msg_2', model: '<synthetic>', usage } }),
      new Set(),
      days
    )

    expect(Object.keys(days)).toHaveLength(0)
  })

  test('tokens are attributed to the branch and the model', () => {
    const days: UsageDays = {}
    consumeTranscriptLine(transcript({ gitBranch: 'feat/stats' }), new Set(), days)

    const summary = summarizeDays(days)
    expect(summary.branches).toEqual([['feat/stats', 120]])
    expect(summary.models).toEqual([['claude-opus-5', 120]])
  })
})

describe('consumeHistoryLine', () => {
  test('numeric and quoted epoch millis bucket to the same day', () => {
    const ms = new Date(2026, 2, 5, 12, 0, 0).getTime()
    const days: UsageDays = {}

    consumeHistoryLine(JSON.stringify({ timestamp: ms }), days)
    consumeHistoryLine(JSON.stringify({ timestamp: String(ms) }), days)

    // Claude Code stores it as a number today but has shipped it quoted before;
    // `new Date(quoted)` returns Invalid Date and would drop the entry silently.
    expect(days[localDay(new Date(ms))]?.prompts).toBe(2)
  })

  test('unparseable timestamps are skipped', () => {
    const days: UsageDays = {}
    consumeHistoryLine(JSON.stringify({ timestamp: 'garbage' }), days)
    consumeHistoryLine(JSON.stringify({ timestamp: 0 }), days)

    expect(Object.keys(days)).toHaveLength(0)
  })
})

describe('localDay', () => {
  test('buckets by local calendar, not UTC', () => {
    // 23:30 local on the 5th is already the 6th in UTC for anyone east of
    // Greenwich, so a toISOString()-based implementation shifts every evening of
    // the year one cell to the right.
    const evening = new Date(2026, 0, 5, 23, 30)
    expect(localDay(evening)).toBe('2026-01-05')
  })
})

describe('buildHeatmap', () => {
  test('is seven rows by the requested number of weeks, ending this week', () => {
    const today = new Date(2026, 7, 3) // a Monday
    const grid = buildHeatmap({ '2026-08-03': 5 }, 4, today)

    expect(grid).toHaveLength(7)
    expect(grid[0]).toHaveLength(4)
    // Today is Monday, so it sits in the top cell of the last column.
    expect(grid[0]?.[3]?.day).toBe('2026-08-03')
    expect(grid[0]?.[3]?.value).toBe(5)
  })

  test('cells past today are left empty', () => {
    const today = new Date(2026, 7, 3) // Monday: Tue..Sun of this week are ahead
    const grid = buildHeatmap({}, 2, today)

    expect(grid[1]?.[1]?.day).toBe('')
    expect(grid[6]?.[1]?.day).toBe('')
  })

  test('the top row stays Monday whatever span is asked for', () => {
    // A span crossing an odd number of DST changes is not a whole number of 24h
    // days. Computed in milliseconds it lands on 23:00 the day before and
    // rotates every weekday row by one — which only shows up at some widths,
    // because a span crossing two transitions cancels out.
    for (const weeks of [8, 26, 40, 53, 54]) {
      const grid = buildHeatmap({}, weeks, new Date(2026, 7, 3))
      for (const cell of grid[0] ?? []) {
        if (cell.day === '') continue
        const [year, month, day] = cell.day.split('-').map(Number)
        const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1)
        expect({ day: date.getDay(), weeks }).toEqual({ day: 1, weeks })
      }
    }
  })
})

describe('grid presentation', () => {
  test('the span is bounded by what is recorded, not by a full year', () => {
    const days: UsageDays = { '2026-07-06': day(3, 0), '2026-08-03': day(4, 0) }
    // Four weeks of data must not open on forty-eight empty columns.
    expect(coveredWeeks(days, new Date(2026, 7, 3), 53)).toBeLessThan(10)
  })

  test('an empty store still asks for a small grid rather than none', () => {
    expect(coveredWeeks({}, new Date(2026, 7, 3), 53)).toBeGreaterThan(0)
  })

  test('the month ruler tracks the cell width', () => {
    const grid = buildHeatmap({}, 6, new Date(2026, 7, 3))
    expect(monthRuler(grid, 6, 1)).toHaveLength(6)
    expect(monthRuler(grid, 6, 2)).toHaveLength(12)
    // Same letters, twice the stride.
    expect(monthRuler(grid, 6, 2).replaceAll(' ', '')).toBe(
      monthRuler(grid, 6, 1).replaceAll(' ', '')
    )
  })

  test('mixColor interpolates and never fades the ramp out', () => {
    const half = mixColor('#000000', '#ffffff', 0.5)
    expect(Math.round(half.r * 255)).toBe(128)
    expect(half.a).toBe(1)
    expect(mixColor('#000000', '#ffffff', 0).r).toBe(0)
    expect(mixColor('#000000', '#ffffff', 1).r).toBe(1)
    // A transparent anchor must not drag the whole ramp to alpha 0 and blank the grid.
    expect(mixColor('transparent', '#00ff00', 0.5).a).toBe(1)
  })
})

describe('usage history file', () => {
  test('round-trips through disk', () => {
    withHome()
    const fresh: UsageTools = { claude: { '2026-03-01': day(3, 300) } }

    expect(saveUsageHistory(fresh)).toBe(true)

    const read = readUsageHistory()
    expect(read.version).toBe(HISTORY_VERSION)
    expect(read.tools.claude?.['2026-03-01']?.prompts).toBe(3)
  })

  test('refuses to overwrite a file written by a newer version', () => {
    const path = withHome()
    const foreign = `${JSON.stringify({ tools: {}, version: 99 }, null, 2)}\n`
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, foreign)

    // Reading it to render is harmless; writing it back would drop whatever
    // fields this build does not know about, and nothing can regenerate them.
    expect(saveUsageHistory({ claude: { '2026-03-01': day(1, 1) } })).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe(foreign)
  })

  test('refuses to overwrite a file it cannot parse', () => {
    const path = withHome()
    const corrupt = '{"tools":{"claude":{"2026-01-13":'
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, corrupt)

    // A truncated file may still hold years of days no rollup can reach any
    // more. Treating "unparseable" as "empty" would replace all of it with the
    // ~36 days still on disk, which is the one unrecoverable outcome here.
    expect(saveUsageHistory({ claude: { '2026-03-01': day(1, 1) } })).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe(corrupt)
  })

  test('a missing file reads as empty and is writable', () => {
    withHome()
    expect(readUsageHistory().tools).toEqual({})
    expect(saveUsageHistory({ claude: { '2026-03-01': day(1, 1) } })).toBe(true)
  })
})
