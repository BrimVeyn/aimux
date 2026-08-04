import { testRender } from '@opentui/react/test-utils'
import { describe, expect, test } from 'bun:test'

import {
  emptyDay,
  localDay,
  type UsageDay,
  type UsageDays,
} from '../../src/services/usage-history/store'
import { DAY_FACTS_HEIGHT } from '../../src/ui/components/stats/day-facts'
import { Heatmap } from '../../src/ui/components/stats/heatmap'

/**
 * The calendar's readout follows the pointer.
 *
 * There is no open or closed state to assert — that is the point of the design,
 * and it is what the popover it replaced kept getting wrong. What has to hold
 * is that the slot always says something, that it says the right day, and that
 * it never changes height as the pointer sweeps across a year.
 */

const TODAY = new Date(2026, 7, 1)
const RAMP = ['#222222', '#334455', '#446688', '#5588bb', '#66aaff']
const WIDTH = 80
/** Wide enough for the panel to stand beside the grid. */
const WIDE = 130

/** Rich enough to exercise every row the readout can carry. */
function richDay(prompts: number): UsageDay {
  const day = emptyDay()
  const noon = new Date(TODAY).setHours(14, 30, 0, 0)
  return {
    ...day,
    branches: { main: 900 },
    hours: day.hours.map((_, hour) => (hour === 14 ? prompts : 0)),
    models: { 'claude-opus-5': 900 },
    projects: { '/tmp/aimux': 900 },
    promptChars: { count: prompts, max: 400, sum: prompts * 120 },
    prompts,
    sessions: { one: { first: noon - 3_600_000, last: noon, prompts } },
    tokens: { cacheRead: 500, cacheWrite: 10, input: 200, output: 200, total: 900 },
    turnMs: { count: prompts, max: 9000, sum: prompts * 4000 },
  }
}

function fixture(): UsageDays {
  const days: UsageDays = {}
  for (let back = 0; back < 30; back++) {
    const date = new Date(TODAY)
    date.setDate(date.getDate() - back)
    // Every third day bare: an old day whose transcripts have been pruned keeps
    // its prompts and nothing else, and the slot must not change height for it.
    // localDay, not toISOString: the calendar keys days in local time, and
    // west of UTC+0 a midnight date stamps as the day before.
    days[localDay(date)] = back % 3 === 0 ? { ...emptyDay(), prompts: 5 } : richDay(10 + back)
  }
  return days
}

async function mount(width = WIDTH) {
  const { captureCharFrame, mockMouse, renderOnce } = await testRender(
    <Heatmap days={fixture()} ramp={RAMP} today={TODAY} width={width} />,
    { height: 24, width: width + 2 }
  )
  await renderOnce()
  return {
    frame: captureCharFrame,
    mockMouse,
    settle: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      await renderOnce()
    },
  }
}

/** The rows the calendar's own box occupies, readout excluded. */
function gridRows(frame: string): number {
  const bottomLeft = frame.split('\n').findIndex((line) => line.startsWith('\u{2570}'))
  expect(bottomLeft).toBeGreaterThan(0)
  return bottomLeft + 1
}

/** The cell `week` columns from the left, on the row labelled `label`. */
function cellAt(frame: string, label: string, week: number): [number, number] {
  // Anchored on the grid's own border: the panel's title carries day names too,
  // and `Saturday 1 August` would otherwise match the Sat row.
  const y = frame.split('\n').findIndex((line) => line.startsWith(`\u{2502} ${label}`))
  expect(y).toBeGreaterThan(0)
  // Border and padding, the day-name gutter, then two columns per week.
  return [2 + 5 + week * 2, y]
}

describe('heatmap readout', () => {
  test('it shows today before the pointer has been anywhere', async () => {
    const { frame } = await mount()
    // 1 August 2026 is a Saturday.
    expect(frame()).toContain('Saturday 1 August')
  })

  test('moving the pointer over a cell reads that day out', async () => {
    const { frame, mockMouse, settle } = await mount()
    const [x, y] = cellAt(frame(), 'Wed', 3)

    await mockMouse.moveTo(x, y)
    await settle()
    expect(frame()).toContain('Wednesday')
    expect(frame()).not.toContain('Saturday 1 August')
  })

  test('the calendar is never covered, whatever the pointer is over', async () => {
    const { frame, mockMouse, settle } = await mount()
    const rows = gridRows(frame())
    const shape = (): number[] =>
      frame()
        .split('\n')
        .slice(0, rows)
        .map((line) => line.trimEnd().length)
    const before = shape()

    for (const label of ['Sun', 'Wed', 'Sat']) {
      const [x, y] = cellAt(frame(), label, 2)
      await mockMouse.moveTo(x, y)
      await settle()
      // The popover this replaced sat on top of these very rows.
      expect(shape()).toEqual(before)
    }
  })

  test('the readout stays inside its slot for days rich and bare alike', async () => {
    const { frame, mockMouse, settle } = await mount()
    const rows = gridRows(frame())
    const bottom = rows + DAY_FACTS_HEIGHT

    for (const label of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
      for (const week of [0, 2, 4]) {
        const [x, y] = cellAt(frame(), label, week)
        await mockMouse.moveTo(x, y)
        await settle()
        const lines = frame().split('\n')
        // A day with three fact lines and a pruned one with a single line both
        // have to end above the same row, or everything below the calendar
        // shifts as the pointer crosses it.
        const last = lines.findLastIndex((line) => line.trim() !== '')
        expect(`${label}/${String(week)}: ${String(last)}`).toBe(
          `${label}/${String(week)}: ${String(Math.min(last, bottom - 1))}`
        )
        expect(lines[rows]?.trim()).not.toBe('')
      }
    }
  })

  test('the panel stands beside the calendar when the room is there', async () => {
    const { frame, mockMouse, settle } = await mount(WIDE)
    const lines = frame().split('\n')
    const sat = lines.findIndex((line) => line.startsWith('\u{2502} Sat'))

    // The date rides the panel's border on the same line as the calendar's own
    // top border — which is only true when the two stand side by side.
    expect(lines[0]?.startsWith('\u{256D}')).toBe(true)
    expect(lines[0]).toContain('Saturday 1 August')

    // And it still follows the pointer from there.
    const [x, y] = cellAt(frame(), 'Wed', 3)
    await mockMouse.moveTo(x, y)
    await settle()
    expect(frame().split('\n')[0]).toContain('Wednesday')
    // Nothing moved into the calendar's rows.
    expect(frame().split('\n')[sat]?.startsWith('\u{2502} Sat')).toBe(true)
  })

  test('a click reads the day out too, for terminals that send no motion', async () => {
    const { frame, mockMouse, settle } = await mount()
    const [x, y] = cellAt(frame(), 'Wed', 3)

    await mockMouse.click(x, y)
    await settle()
    expect(frame()).not.toContain('Saturday 1 August')
  })
})
