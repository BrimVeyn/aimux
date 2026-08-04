import type { CounterDays } from '../../../services/aimux-counters/store'
import type { StatsData } from './use-stats-data'

import {
  lastCounterDays,
  peakOf,
  summarizeCounter,
  sumOf,
} from '../../../services/aimux-counters/summary'
import { formatCompact } from '../../format-number'
import { chartColumns } from './chart'
import {
  formatCount,
  formatDayLabel,
  formatDuration,
  formatFingerDistance,
  formatSpan,
  weeklyLabels,
} from './format'
import {
  FactGrid,
  GLYPH,
  Muted,
  pageLayout,
  PageNotice,
  type PageTile,
  recordsOf,
  RecordsSection,
  Section,
  StatsPage,
  TwoColumn,
  VBarChart,
} from './shared'

/**
 * aimux — what the editor itself has seen.
 *
 * Two daily series and a block of totals. The series are the point: "12 hours
 * today" against "6 hours on an average day" is a comparison a reader has to do
 * in their head, and a chart of the last few weeks does it for them.
 *
 * Everything here is a count and nothing else — no key identity, no content, and
 * nothing that leaves the machine.
 */

const MS_PER_MINUTE = 60_000
/** Two charts side by side, short enough that the totals below stay on screen. */
const CHART_HEIGHT = 7

/** The axis is in minutes so the gridlines land on 30, 60, 120 — round clock numbers. */
function formatMinutes(minutes: number): string {
  return formatDuration(minutes * MS_PER_MINUTE)
}

/** Named rather than inlined so the series is a call's result, not an array built in render. */
function uptimeMinutes(counters: CounterDays, count: number, today: Date): number[] {
  return lastCounterDays(counters, count, today, 'uptimeMs').map((ms) => ms / MS_PER_MINUTE)
}

/**
 * The lifetime totals, as label/value pairs.
 *
 * Counts of unrelated things: a bar between "workspaces" and "lines scrolled"
 * would encode a comparison nobody is making, so they are simply listed.
 */
function builtFacts(counters: CounterDays): [string, string][] {
  const vertical = sumOf(counters, 'splitsVertical')
  const splits = vertical + sumOf(counters, 'splitsHorizontal')
  return [
    ['Workspaces', formatCount(sumOf(counters, 'workspacesCreated'))],
    ['Runs', formatCount(sumOf(counters, 'runsStarted'))],
    ['Tabs', formatCount(sumOf(counters, 'tabsOpened'))],
    [
      'Splits',
      splits === 0
        ? '0'
        : `${formatCount(splits)} \u{00B7} ${Math.round((vertical / splits) * 100)}% vertical`,
    ],
    ['Snippets', formatCount(sumOf(counters, 'snippetsFired'))],
    ['Lines scrolled', formatCompact(sumOf(counters, 'scrollLines'))],
    ['Daemon restarts', formatCount(sumOf(counters, 'daemonRestarts'))],
    ['Days counted', formatCount(Object.keys(counters).length)],
  ]
}

function aimuxTiles(uptimeMs: number, keys: number, runs: number): PageTile[] {
  return [
    { glyph: GLYPH.clock, label: 'In aimux', value: formatSpan(uptimeMs) },
    { glyph: GLYPH.keyboard, label: 'Keys', value: formatCount(keys) },
    { glyph: GLYPH.distance, label: 'Distance', value: formatFingerDistance(keys) },
    { glyph: GLYPH.aimux, label: 'Runs', value: formatCount(runs) },
  ]
}

export function AimuxPage({ data, width }: { data: StatsData; width: number }) {
  const { counters, today, todayDate } = data

  // First, before the derivations it would make pointless.
  if (Object.keys(counters).length === 0) {
    return (
      <PageNotice>nothing counted yet — this starts the first time aimux runs with it</PageNotice>
    )
  }

  const { split, usable } = pageLayout(width)
  const { leftWidth, rightWidth } = split

  const uptime = summarizeCounter(counters, 'uptimeMs', today)
  const keys = summarizeCounter(counters, 'keys', today)
  const tabs = summarizeCounter(counters, 'tabsOpened', today)
  const longestRun = peakOf(counters, 'longestRunMs')
  const dailyUptime = uptime.days === 0 ? 0 : uptime.total / uptime.days

  const uptimeDays = chartColumns(leftWidth - 9)
  const uptimeSeries = uptimeMinutes(counters, uptimeDays, todayDate)
  const uptimeLabels = weeklyLabels(uptimeDays, todayDate)

  const keyDays = chartColumns(rightWidth - 8)
  const keySeries = lastCounterDays(counters, keyDays, todayDate, 'keys')
  const keyLabels = weeklyLabels(keyDays, todayDate)

  const built = builtFacts(counters)

  // Only records that exist. A row of `—` teaches nothing and reads as broken.
  const records = recordsOf([
    longestRun.value === 0
      ? null
      : {
          label: 'Longest run',
          value: formatDuration(longestRun.value),
          when: formatDayLabel(longestRun.day),
        },
    uptime.best.value === 0
      ? null
      : {
          label: 'Longest day',
          value: formatDuration(uptime.best.value),
          when: formatDayLabel(uptime.best.day),
        },
    keys.best.value === 0
      ? null
      : {
          label: 'Most keystrokes',
          value: formatCount(keys.best.value),
          when: formatDayLabel(keys.best.day),
        },
    tabs.best.value === 0
      ? null
      : {
          label: 'Most tabs',
          value: `${formatCount(tabs.best.value)} opened`,
          when: formatDayLabel(tabs.best.day),
        },
    keys.total === 0
      ? null
      : {
          label: 'Finger mileage',
          value: formatFingerDistance(keys.total),
          when: 'at 0.8 mm a key',
        },
  ])

  const left = (
    <Section
      glyph={GLYPH.clock}
      title="Time a day"
      note={uptime.days === 0 ? '' : `${formatDuration(dailyUptime)} on an average day`}
      width={leftWidth}
    >
      {uptime.total === 0 ? (
        <Muted>counted from the next run onward</Muted>
      ) : (
        <>
          <VBarChart
            caption={`last ${uptimeDays} days`}
            format={formatMinutes}
            height={CHART_HEIGHT}
            labels={uptimeLabels}
            values={uptimeSeries}
          />
          <Muted>
            {[
              `today ${formatDuration(uptime.today)}`,
              `best ${formatDuration(uptime.best.value)}`,
              `longest run ${formatDuration(longestRun.value)}`,
            ].join(' \u{00B7} ')}
          </Muted>
        </>
      )}
    </Section>
  )

  const right = (
    <Section
      glyph={GLYPH.keyboard}
      title="Keys a day"
      note={keys.today === 0 ? '' : `${formatCount(keys.today)} today`}
      width={rightWidth}
    >
      {keys.total === 0 ? (
        <Muted>counted from the next run onward</Muted>
      ) : (
        <>
          <VBarChart
            caption={`last ${keyDays} days`}
            format={formatCompact}
            height={CHART_HEIGHT}
            labels={keyLabels}
            values={keySeries}
          />
          <Muted>
            {[
              `${formatCompact(keys.total)} all time`,
              `best ${formatCount(keys.best.value)}`,
              `${formatFingerDistance(keys.total)} of travel`,
            ].join(' \u{00B7} ')}
          </Muted>
        </>
      )}
    </Section>
  )

  return (
    <StatsPage
      tiles={aimuxTiles(uptime.total, keys.total, sumOf(counters, 'runsStarted'))}
      usable={usable}
    >
      <TwoColumn split={split}>
        {left}
        {right}
      </TwoColumn>

      <Section glyph={GLYPH.aimux} title="What you built" note="all time" width={usable}>
        <FactGrid columns={split.twoUp ? 2 : 1} facts={built} width={usable} />
      </Section>

      <RecordsSection
        empty="nothing to beat yet — records appear as aimux is used"
        records={records}
        width={usable}
      />
      <Muted>A count and nothing else — no key identity is recorded.</Muted>
    </StatsPage>
  )
}
