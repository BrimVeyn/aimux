/* eslint-disable react-perf/jsx-no-new-array-as-prop -- The row arrays are
   derived per render and `StatTable` is deliberately not memoized, so a stable
   identity would buy nothing: the rule guards memoized children. */
import type { StatsData } from './use-stats-data'

import { peakOf, summarizeCounter } from '../../../services/aimux-counters/summary'
import { dayCost, formatUsd } from '../../../services/usage-history/cost'
import {
  lateNightPrompts,
  peakDay,
  sessionStats,
  streaks,
} from '../../../services/usage-history/insights'
import { formatCount, formatDayLabel, formatDuration, formatFingerDistance } from './format'
import { GLYPH, Muted, Panel, StatTable, type TableColumn } from './shared'

const RECORD_COLUMNS: TableColumn[] = [
  { align: 'left', header: 'Record' },
  { header: 'Value' },
  { align: 'left', header: 'When' },
]

export function RecordsPage({ data }: { data: StatsData }) {
  const { claude, counters, today, todayDate } = data

  const busiest = peakDay(claude, (day) => day.prompts)
  const priciest = peakDay(claude, (day) => dayCost(day).total)
  const sessions = sessionStats(claude)
  const streak = streaks(claude, todayDate)
  const lateNight = lateNightPrompts(claude)
  const keys = summarizeCounter(counters, 'keys', today)
  const longestRun = peakOf(counters, 'longestRunMs')

  // Only records that exist. A table of `—` teaches nothing and reads as broken.
  const rows: string[][] = []
  const add = (name: string, value: string, when: string): void => {
    rows.push([name, value, when])
  }

  if (busiest.value > 0) {
    add('Busiest day', `${formatCount(busiest.value)} prompts`, formatDayLabel(busiest.day))
  }
  if (streak.longest > 0) add('Longest streak', `${streak.longest} days`, '')
  if (sessions.longestMs > 0) {
    add(
      'Longest AI session',
      formatDuration(sessions.longestMs),
      formatDayLabel(sessions.longestDay)
    )
  }
  if (longestRun.value > 0) {
    add('Longest aimux run', formatDuration(longestRun.value), formatDayLabel(longestRun.day))
  }
  if (keys.best.value > 0) {
    add('Most keystrokes', formatCount(keys.best.value), formatDayLabel(keys.best.day))
  }
  if (priciest.value > 0) {
    add('Priciest day', `${formatUsd(priciest.value)} est.`, formatDayLabel(priciest.day))
  }
  if (lateNight > 0) {
    add('Late-night prompts', formatCount(lateNight), 'between 02:00 and 05:00')
  }
  if (keys.total > 0) {
    add('Finger mileage', formatFingerDistance(keys.total), 'at 0.8 mm a key')
  }

  return (
    <Panel
      glyph={GLYPH.records}
      title="Records"
      note={rows.length === 0 ? '' : `${rows.length} set`}
    >
      {rows.length === 0 ? (
        <Muted>nothing to beat yet — records appear as history accumulates</Muted>
      ) : (
        <StatTable columns={RECORD_COLUMNS} rows={rows} />
      )}
    </Panel>
  )
}
