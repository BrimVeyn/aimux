import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { dayCost, rateFor, totalCost } from '../../src/services/usage-history/cost'
import {
  hourTotals,
  lateNightPrompts,
  sessionStats,
  streaks,
  typicalDay,
  weekdayTotals,
} from '../../src/services/usage-history/insights'
import {
  consumeHistoryLine,
  consumeTranscriptLine,
  readJsonlLines,
  type TranscriptFileState,
} from '../../src/services/usage-history/rollup'
import {
  buildHeatmap,
  coveredWeeks,
  mixColor,
  monthLabels,
  summarizeDays,
} from '../../src/services/usage-history/stats'
import {
  emptyDay,
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
    ...emptyDay(),
    branches: { main: total },
    models: { 'claude-opus-5': total },
    prompts,
    tokens: { cacheRead: 0, cacheWrite: 0, input: total, output: 0, total },
    ...extra,
  }
}

function transcriptState(): TranscriptFileState {
  return { previousMs: null }
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
    const state = transcriptState()
    const line = transcript({})

    consumeTranscriptLine(line, seen, days, state)
    consumeTranscriptLine(line, seen, days, state)

    // Claude Code copies earlier turns into a new transcript on resume, so the
    // same billed request genuinely appears in several files.
    expect(summarizeDays(days).tokens.total).toBe(120)
  })

  test('a different request id is a different billed request', () => {
    const days: UsageDays = {}
    const seen = new Set<string>()

    consumeTranscriptLine(transcript({}), seen, days, transcriptState())
    consumeTranscriptLine(transcript({ requestId: 'req_2' }), seen, days, transcriptState())

    expect(summarizeDays(days).tokens.total).toBe(240)
  })

  test('synthetic assistant messages contribute nothing', () => {
    const days: UsageDays = {}
    consumeTranscriptLine(
      transcript({ message: { id: 'msg_2', model: '<synthetic>', usage } }),
      new Set(),
      days,
      transcriptState()
    )

    expect(Object.keys(days)).toHaveLength(0)
  })

  test('tokens are attributed to the branch and the model', () => {
    const days: UsageDays = {}
    consumeTranscriptLine(
      transcript({ gitBranch: 'feat/stats' }),
      new Set(),
      days,
      transcriptState()
    )

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
    // Weeks run Sunday to Saturday, so a Monday sits in the second row.
    expect(grid[1]?.[3]?.day).toBe('2026-08-03')
    expect(grid[1]?.[3]?.value).toBe(5)
  })

  test('cells past today are left empty', () => {
    const today = new Date(2026, 7, 3) // Monday: Tue..Sat of this week are ahead
    const grid = buildHeatmap({}, 2, today)

    expect(grid[2]?.[1]?.day).toBe('')
    expect(grid[6]?.[1]?.day).toBe('')
  })

  test('the top row stays Sunday whatever span is asked for', () => {
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
        expect({ day: date.getDay(), weeks }).toEqual({ day: 0, weeks })
      }
    }
  })

  test('every row is the weekday its label claims', () => {
    const grid = buildHeatmap({}, 12, new Date(2026, 7, 3))
    for (const [row, cells] of grid.entries()) {
      for (const cell of cells) {
        if (cell.day === '') continue
        const [year, month, day] = cell.day.split('-').map(Number)
        expect(new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).getDay()).toBe(row)
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

  test('month labels stay inside the grid at any cell width', () => {
    const grid = buildHeatmap({}, 12, new Date(2026, 7, 3))

    for (const cellWidth of [1, 2, 3]) {
      for (const label of monthLabels(grid, 12, cellWidth)) {
        expect(label.offset).toBeGreaterThanOrEqual(0)
        // A name running off the right edge would be clipped mid-word, which
        // reads as a rendering bug rather than as a label.
        expect(label.offset + label.name.length).toBeLessThanOrEqual(12 * cellWidth)
      }
    }
  })

  test('a narrow grid drops the labels it cannot fit rather than clipping them', () => {
    const grid = buildHeatmap({}, 12, new Date(2026, 7, 3))
    const wide = monthLabels(grid, 12, 3).map((label) => label.name)
    const narrow = monthLabels(grid, 12, 1).map((label) => label.name)

    // Fewer names, never different ones, and never a truncated one.
    expect(narrow.length).toBeLessThanOrEqual(wide.length)
    expect(wide).toEqual(expect.arrayContaining(narrow))
    for (const name of narrow) expect(name).toHaveLength(3)
  })

  test('decoration widens the spacing, so a swatch cannot collide with the next name', () => {
    const grid = buildHeatmap({}, 53, new Date(2026, 7, 3))
    const decoration = 2
    const labels = monthLabels(grid, 53, 2, decoration)

    for (const [index, label] of labels.entries()) {
      if (index === 0) continue
      const previous = labels[index - 1]
      if (previous === undefined) continue
      // The caller draws `decoration` extra cells per label; without accounting
      // for them the gap looks fine here and the swatch lands on the last
      // letter of the month before it.
      expect(label.offset).toBeGreaterThanOrEqual(
        previous.offset + previous.name.length + decoration
      )
    }
  })

  test('month labels never overlap each other', () => {
    const grid = buildHeatmap({}, 53, new Date(2026, 7, 3))
    const labels = monthLabels(grid, 53, 3)
    expect(labels.length).toBeGreaterThan(6)

    for (const [index, label] of labels.entries()) {
      if (index === 0) continue
      const previous = labels[index - 1]
      if (previous === undefined) continue
      expect(label.offset).toBeGreaterThan(previous.offset + previous.name.length - 1)
    }
  })

  test('a label carries the month it belongs to, so it can be coloured like its cells', () => {
    const grid = buildHeatmap({}, 12, new Date(2026, 7, 3))
    for (const label of monthLabels(grid, 12, 3)) {
      expect(label.month).toBeGreaterThanOrEqual(0)
      expect(label.month).toBeLessThan(12)
    }
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

describe('history v1 -> v2 migration', () => {
  /** A day as the v1 rollup wrote it: none of the fields v2 added. */
  function v1Day(prompts: number, total: number): UsageDay {
    return {
      branches: { main: total },
      models: { 'claude-opus-5': total },
      prompts,
      tokens: { cacheRead: 0, cacheWrite: 0, input: total, output: 0, total },
      // Deliberately not a UsageDay: the point of these tests is what happens to
      // a day written before the v2 fields existed.
    } as unknown as UsageDay
  }

  test('a v1 file is read, upgraded and written back without losing a day', () => {
    const path = withHome()
    const v1 = { tools: { claude: { '2026-01-13': v1Day(31, 777) } }, version: 1 }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(v1, null, 2)}\n`)

    // The refusal guard has to let an *older* file through — that is the only way
    // the upgrade ever happens. Refusing it would freeze every existing install
    // on v1 forever.
    expect(saveUsageHistory({ claude: { '2026-08-03': day(5, 10) } })).toBe(true)

    const read = readUsageHistory()
    expect(read.version).toBe(HISTORY_VERSION)
    expect(read.tools.claude?.['2026-01-13']?.prompts).toBe(31)
    expect(read.tools.claude?.['2026-08-03']?.prompts).toBe(5)
  })

  test('reading fills in the fields a v1 day never had', () => {
    const path = withHome()
    const v1 = { tools: { claude: { '2026-01-13': v1Day(31, 777) } }, version: 1 }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(v1, null, 2)}\n`)

    const migrated = readUsageHistory().tools.claude?.['2026-01-13']

    // Every reader sees one shape. The values are empty rather than zeroed, so a
    // page can tell "no data recorded" from "measured zero".
    expect(migrated?.hours).toHaveLength(24)
    expect(migrated?.sessions).toEqual({})
    expect(migrated?.promptChars.count).toBe(0)
  })

  test('a fresh v2 day beats the migrated v1 day it replaces', () => {
    const stored: UsageTools = { claude: { '2026-01-13': v1Day(31, 777) } }
    const fresh: UsageTools = {
      claude: { '2026-01-13': day(31, 777, { hours: Array.from({ length: 24 }, () => 1) }) },
    }

    const merged = mergeUsageHistory(stored, fresh).claude?.['2026-01-13']

    // Same prompt count on both sides, so `>=` has to pick the fresh one —
    // otherwise the new fields would never populate for a day already on disk.
    expect(merged?.hours[0]).toBe(1)
  })
})

describe('streaks', () => {
  function promptDays(keys: string[]): UsageDays {
    const days: UsageDays = {}
    for (const key of keys) days[key] = day(1, 0)
    return days
  }

  test('a run ending yesterday is still current', () => {
    const days = promptDays(['2026-08-01', '2026-08-02'])
    // The day is not over. Breaking the streak at midnight would report every
    // morning as a reset, before the user has had a chance to prompt.
    expect(streaks(days, new Date(2026, 7, 3)).current).toBe(2)
  })

  test('a run ending two days ago is broken', () => {
    const days = promptDays(['2026-08-01'])
    expect(streaks(days, new Date(2026, 7, 3)).current).toBe(0)
  })

  test('the longest run and the longest gap are both reported', () => {
    const days = promptDays(['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-10', '2026-08-03'])
    const result = streaks(days, new Date(2026, 7, 3))

    expect(result.longest).toBe(3)
    // 07-10 to 08-03 is 24 days apart, so 23 blank days sit between them.
    expect(result.longestGapDays).toBe(23)
    expect(result.current).toBe(1)
  })

  test('days with no prompts do not extend a run', () => {
    const days = promptDays(['2026-08-01', '2026-08-03'])
    days['2026-08-02'] = day(0, 500)

    // A day with tokens but no prompts is a day the prompt log never saw; it
    // must not silently bridge two runs.
    expect(streaks(days, new Date(2026, 7, 3)).longest).toBe(1)
  })

  test('an empty store has no streak rather than a streak of one', () => {
    expect(streaks({}, new Date(2026, 7, 3))).toEqual({
      current: 0,
      longest: 0,
      longestGapDays: 0,
    })
  })
})

describe('hour, weekday and typical-day derivations', () => {
  test('hours sum across days into 24 buckets', () => {
    const first = day(2, 0)
    first.hours[9] = 2
    const second = day(3, 0)
    second.hours[9] = 1
    second.hours[23] = 2

    const totals = hourTotals({ '2026-08-01': first, '2026-08-02': second })

    expect(totals).toHaveLength(24)
    expect(totals[9]).toBe(3)
    expect(totals[23]).toBe(2)
    expect(totals[0]).toBe(0)
  })

  test('weekdays are Monday-first, matching the heatmap rows', () => {
    // 2026-08-03 is a Monday, 2026-08-09 the Sunday that closes that week.
    const totals = weekdayTotals({ '2026-08-03': day(4, 0), '2026-08-09': day(7, 0) })

    expect(totals[0]).toBe(4)
    expect(totals[6]).toBe(7)
  })

  test('late-night prompts count 02:00 through 04:59 only', () => {
    const late = day(4, 0)
    late.hours[1] = 1
    late.hours[2] = 1
    late.hours[4] = 2
    late.hours[5] = 9

    expect(lateNightPrompts({ '2026-08-03': late })).toBe(3)
  })

  test('the typical day comes from session spans, not hour buckets', () => {
    const target = day(2, 0)
    target.sessions = {
      a: {
        first: new Date(2026, 7, 3, 9, 12).getTime(),
        last: new Date(2026, 7, 3, 9, 30).getTime(),
        prompts: 2,
      },
      b: {
        first: new Date(2026, 7, 3, 18, 0).getTime(),
        last: new Date(2026, 7, 3, 23, 48).getTime(),
        prompts: 3,
      },
    }

    const typical = typicalDay({ '2026-08-03': target })

    // To the minute. The hour buckets would only ever say 09:00, which reads as
    // a rounded guess rather than a measurement.
    expect(typical.startMinutes).toBe(9 * 60 + 12)
    expect(typical.endMinutes).toBe(23 * 60 + 48)
    expect(typical.days).toBe(1)
  })

  test('a day with no sessions contributes nothing to the typical day', () => {
    // Otherwise a v1 day, which has no sessions at all, would drag both averages
    // toward midnight and the page would render that as fact.
    expect(typicalDay({ '2026-01-13': day(31, 777) }).days).toBe(0)
  })
})

describe('sessionStats', () => {
  const hour = 3_600_000

  function withSessions(
    sessions: Record<string, { first: number; last: number; prompts: number }>
  ) {
    const target = day(9, 0)
    target.sessions = sessions
    return target
  }

  test('reports count, median, longest and the day the longest fell on', () => {
    const base = new Date(2026, 7, 3, 9, 0).getTime()
    const days: UsageDays = {
      '2026-08-03': withSessions({
        a: { first: base, last: base + hour, prompts: 4 },
        b: { first: base, last: base + 2 * hour, prompts: 5 },
      }),
      '2026-08-04': withSessions({
        c: { first: base, last: base + 5 * hour, prompts: 9 },
      }),
    }

    const stats = sessionStats(days)

    expect(stats.count).toBe(3)
    expect(stats.days).toBe(2)
    expect(stats.longestMs).toBe(5 * hour)
    expect(stats.longestDay).toBe('2026-08-04')
    expect(stats.medianMs).toBe(2 * hour)
  })

  test('single-prompt sessions are counted, not filtered out', () => {
    const base = new Date(2026, 7, 3, 9, 0).getTime()
    const stats = sessionStats({
      '2026-08-03': withSessions({
        a: { first: base, last: base, prompts: 1 },
        b: { first: base, last: base + hour, prompts: 6 },
      }),
    })

    // They last ~0 and would drag the median down invisibly. Reporting how many
    // there are lets the page say so instead of hiding them.
    expect(stats.singlePrompt).toBe(1)
    expect(stats.count).toBe(2)
  })
})

describe('cost', () => {
  test('rates match by prefix so dated snapshots resolve', () => {
    expect(rateFor('claude-sonnet-4-6-20251114')?.input).toBe(3)
    expect(rateFor('claude-opus-5')?.output).toBe(25)
    expect(rateFor('claude-haiku-4-5-20251001')?.input).toBe(1)
  })

  test('a model with no published rate is left out rather than guessed at', () => {
    expect(rateFor('gpt-5-codex')).toBeNull()
  })

  test('input, output and both cache classes are priced', () => {
    const target = day(0, 0, {
      models: { 'claude-opus-5': 4_000_000 },
      tokens: {
        cacheRead: 1_000_000,
        cacheWrite: 1_000_000,
        input: 1_000_000,
        output: 1_000_000,
        total: 4_000_000,
      },
    })

    // 1M in at $5 + 1M out at $25 + 1M cache-read at $0.50 + 1M cache-write at $6.25
    expect(dayCost(target).total).toBeCloseTo(36.75, 5)
    // The cache reads would have cost $5 at the full input rate; they cost $0.50.
    expect(dayCost(target).saved).toBeCloseTo(4.5, 5)
  })

  test('tokens from an unpriced model are reported, not silently dropped', () => {
    const target = day(0, 0, {
      models: { 'gpt-5-codex': 1_000_000 },
      tokens: { cacheRead: 0, cacheWrite: 0, input: 1_000_000, output: 0, total: 1_000_000 },
    })

    const cost = totalCost({ '2026-08-03': target })

    // Undercounting a total silently is worse than saying which tokens are
    // missing from it, so the pages can render the caveat.
    expect(cost.total).toBe(0)
    expect(cost.unpricedTokens).toBe(1_000_000)
  })
})

describe('consumeHistoryLine v2 fields', () => {
  test('a prompt lands in its hour bucket, project and session', () => {
    const ms = new Date(2026, 7, 3, 15, 30).getTime()
    const days: UsageDays = {}

    consumeHistoryLine(
      JSON.stringify({
        display: 'hello',
        project: '/Users/x/aimux',
        sessionId: 'sess-1',
        timestamp: ms,
      }),
      days
    )

    const target = days[localDay(new Date(ms))]
    expect(target?.hours[15]).toBe(1)
    expect(target?.projects['/Users/x/aimux']).toBe(1)
    expect(target?.sessions['sess-1']?.prompts).toBe(1)
    expect(target?.promptChars).toEqual({ count: 1, max: 5, sum: 5 })
  })

  test('a second prompt in the same session widens its span', () => {
    const first = new Date(2026, 7, 3, 9, 0).getTime()
    const last = new Date(2026, 7, 3, 11, 0).getTime()
    const days: UsageDays = {}

    for (const timestamp of [last, first]) {
      consumeHistoryLine(JSON.stringify({ display: 'x', sessionId: 'sess-1', timestamp }), days)
    }

    // Written out of order on purpose: the span is a min/max, not first-seen.
    const session = days[localDay(new Date(first))]?.sessions['sess-1']
    expect(session).toEqual({ first, last, prompts: 2 })
  })
})

describe('turn gaps', () => {
  const usage = {
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    input_tokens: 100,
    output_tokens: 20,
  }

  function at(minutes: number, id: string): string {
    return JSON.stringify({
      message: { id, model: 'claude-opus-5', usage },
      requestId: id,
      timestamp: new Date(2026, 7, 3, 10, minutes).toISOString(),
    })
  }

  test('consecutive assistant turns contribute their gap', () => {
    const days: UsageDays = {}
    const state = transcriptState()
    const seen = new Set<string>()

    consumeTranscriptLine(at(0, 'a'), seen, days, state)
    consumeTranscriptLine(at(1, 'b'), seen, days, state)

    const turnMs = days[localDay(new Date(2026, 7, 3))]?.turnMs
    expect(turnMs?.count).toBe(1)
    expect(turnMs?.sum).toBe(60_000)
  })

  test('a gap longer than five minutes is the user walking away, not a turn', () => {
    const days: UsageDays = {}
    const state = transcriptState()
    const seen = new Set<string>()

    consumeTranscriptLine(at(0, 'a'), seen, days, state)
    consumeTranscriptLine(at(30, 'b'), seen, days, state)

    // Counted, it would turn the average turn into a measure of lunch breaks.
    expect(days[localDay(new Date(2026, 7, 3))]?.turnMs.count).toBe(0)
  })

  test('the gap does not carry across transcripts', () => {
    const days: UsageDays = {}
    const seen = new Set<string>()

    consumeTranscriptLine(at(0, 'a'), seen, days, transcriptState())
    consumeTranscriptLine(at(1, 'b'), seen, days, transcriptState())

    // Two files parsed back to back are two unrelated conversations; the
    // per-file state is what stops one bleeding into the other.
    expect(days[localDay(new Date(2026, 7, 3))]?.turnMs.count).toBe(0)
  })
})
