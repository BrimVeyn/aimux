import type { BorderSides } from '@opentui/core'

import { formatUsd, totalCost } from '../../../services/usage-history/cost'
import {
  daysBetween,
  hourTotals,
  lastDays,
  parseDayKey,
  streaks,
  typicalDay,
  weekdayTotals,
} from '../../../services/usage-history/insights'
import { summarizeDays } from '../../../services/usage-history/stats'
import { formatCompact } from '../../format-number'
import { useTheme } from '../../theme'
import { chartColumns } from './chart'
import { formatClock, formatCount, formatPercent } from './format'
import { Heatmap, HeatmapLegend, useHeatmapRamp } from './heatmap'
import { QuotaSection } from './quotas'
import {
  BarRow,
  GLYPH,
  HourChart,
  Muted,
  Rule,
  Section,
  StatTile,
  TileRow,
  VBarChart,
} from './shared'
import { isEmpty, type StatsData } from './use-stats-data'

/**
 * Usage — quotas and the shape of the work, on one page.
 *
 * Quotas and activity were two pages answering one question: how much am I
 * using this. Splitting them meant looking at a gauge on one screen and at the
 * days that filled it on another.
 *
 * There are no summary tables here. A table earns its place when several
 * unrelated numbers have to be read against each other; a row of totals nobody
 * compares is just a border drawn around four numbers, and the same numbers sit
 * better on the headline row or in the charts that show how they got there.
 */

/**
 * The page's grid. One padding column either side, two content columns, and a
 * three-cell gutter carrying the vertical rule. Every section, rule and note is
 * measured against these numbers rather than against its own content.
 */
const PAD = 1
const GUTTER = 3
const TWO_COLUMN_MIN = 92

/** Module scope: a fresh array every render would repaint the divider each frame. */
const BORDER_LEFT: BorderSides[] = ['left']

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** Tokens and notional cost per day over the last `span` recorded days. */
function recentBurn(data: StatsData, span = 7): { cost: number; days: number } {
  let cost = 0
  let days = 0
  for (const [key, day] of Object.entries(data.claude)) {
    if (daysBetween(parseDayKey(key), data.todayDate) >= span) continue
    days += 1
    cost += totalCost({ [key]: day }).total
  }
  return { cost: days === 0 ? 0 : cost / days, days }
}

function monthToDate(data: StatsData): { cost: number; elapsed: number; inMonth: number } {
  const prefix = data.today.slice(0, 7)
  let cost = 0
  for (const [key, day] of Object.entries(data.claude)) {
    if (key.startsWith(prefix)) cost += totalCost({ [key]: day }).total
  }
  return {
    cost,
    elapsed: data.todayDate.getDate(),
    inMonth: new Date(data.todayDate.getFullYear(), data.todayDate.getMonth() + 1, 0).getDate(),
  }
}

export function UsagePage({ data, width }: { data: StatsData; width: number }) {
  const t = useTheme()
  const ramp = useHeatmapRamp()
  const now = new Date()

  const usable = Math.max(24, width - PAD * 2)
  const twoUp = usable >= TWO_COLUMN_MIN
  const leftWidth = twoUp ? Math.floor((usable - GUTTER) / 2) : usable
  const rightWidth = twoUp ? usable - GUTTER - leftWidth : usable

  const summary = summarizeDays(data.claude)
  const codexSummary = summarizeDays(data.codex)
  const streak = streaks(data.claude, data.todayDate)
  const hours = hourTotals(data.claude)
  const weekdays = weekdayTotals(data.claude)
  const typical = typicalDay(data.claude)

  const claudeCost = totalCost(data.claude)
  const codexCost = totalCost(data.codex)
  const month = monthToDate(data)
  const burn = recentBurn(data)

  const average =
    summary.promptDays === 0 ? 0 : Math.round(summary.totalPrompts / summary.promptDays)
  const hoursTotal = hours.reduce((sum, value) => sum + value, 0)
  const lateHours = hours.slice(22).reduce((sum, value) => sum + value, 0)
  const peakHour = hours.indexOf(Math.max(...hours))
  const weekendPrompts = (weekdays[5] ?? 0) + (weekdays[6] ?? 0)
  const weekTotal = weekdays.reduce((sum, value) => sum + value, 0)
  const weekdayMax = Math.max(...weekdays)
  const modelMax = summary.models[0]?.[1] ?? 0

  const chartDays = chartColumns(usable - 8)
  const dailyTokens = lastDays(data.claude, chartDays, data.todayDate, (day) => day.tokens.total)

  const tileWidth = Math.floor(usable / 4)
  const hasHistory = !isEmpty(data.claude)

  // The calendar facts, as one muted line rather than a table: nobody reads
  // "busiest day" against "longest gap", they just want to know each.
  const calendarFacts = [
    `${formatCount(summary.promptDays)} active days`,
    summary.peakPrompts === 0 ? '' : `busiest ${formatCount(summary.peakPrompts)}`,
    streak.longest === 0 ? '' : `best streak ${streak.longest}d`,
    streak.longestGapDays === 0 ? '' : `longest gap ${streak.longestGapDays}d`,
  ]
    .filter((part) => part !== '')
    .join(' \u{00B7} ')

  const costFacts = [
    `${formatCompact(summary.tokens.total)} tokens`,
    `${formatUsd(claudeCost.total + codexCost.total)} estimated`,
    `${formatUsd(claudeCost.saved + codexCost.saved)} saved by cache`,
    codexSummary.tokens.total > 0 ? `codex ${formatUsd(codexCost.total)}` : '',
    'not metered',
  ]
    .filter((part) => part !== '')
    .join(' \u{00B7} ')

  const left = (
    <>
      <QuotaSection now={now} width={leftWidth} />

      <Section
        glyph={GLYPH.clock}
        title="Time of day"
        note={hoursTotal === 0 ? '' : `peak ${formatClock(peakHour * 60)}`}
        width={leftWidth}
      >
        {hoursTotal === 0 ? (
          <Muted>recorded from the next rollup onward</Muted>
        ) : (
          <>
            <HourChart values={hours} />
            <Muted>
              {[
                typical.days === 0
                  ? ''
                  : `typical day ${formatClock(typical.startMinutes)} \u{2192} ${formatClock(typical.endMinutes)}`,
                `${formatPercent(lateHours, hoursTotal)} after 22:00`,
              ]
                .filter((part) => part !== '')
                .join(' \u{00B7} ')}
            </Muted>
          </>
        )}
      </Section>
    </>
  )

  const right = (
    <>
      <Section
        glyph={GLYPH.week}
        title="Week"
        note={weekTotal === 0 ? '' : `weekends ${formatPercent(weekendPrompts, weekTotal)}`}
        width={rightWidth}
      >
        {WEEKDAY_LABELS.map((label, index) => (
          <BarRow
            key={label}
            label={label}
            max={weekdayMax}
            total={weekTotal}
            value={weekdays[index] ?? 0}
            valueText={formatCount(weekdays[index] ?? 0)}
            width={rightWidth}
          />
        ))}
      </Section>

      <Section
        glyph={GLYPH.models}
        title="Models"
        note={formatCompact(summary.modelTotal)}
        width={rightWidth}
      >
        {summary.models.length === 0 ? (
          <Muted>no model attribution recorded</Muted>
        ) : (
          summary.models.map(([model, value]) => (
            <BarRow
              key={model}
              label={model.replace('claude-', '')}
              max={modelMax}
              total={summary.modelTotal}
              value={value}
              valueText={formatCompact(value)}
              width={rightWidth}
            />
          ))
        )}
      </Section>
    </>
  )

  return (
    <box flexDirection="column" paddingLeft={PAD} paddingRight={PAD}>
      <TileRow>
        <StatTile
          glyph={GLYPH.calendar}
          label="Prompts"
          value={formatCount(summary.totalPrompts)}
          width={tileWidth}
        />
        <StatTile
          glyph={GLYPH.clock}
          label="Per day"
          value={formatCount(average)}
          width={tileWidth}
        />
        <StatTile
          glyph={GLYPH.streak}
          label="Streak"
          value={`${streak.current}d`}
          width={tileWidth}
        />
        <StatTile
          glyph={GLYPH.cost}
          label="Month"
          value={`${formatUsd(month.cost)} est.`}
          width={usable - tileWidth * 3}
        />
      </TileRow>

      <box paddingTop={1} paddingBottom={1} flexShrink={0}>
        <Rule width={usable} />
      </box>

      {hasHistory ? (
        <Section glyph={GLYPH.calendar} title="Activity" note={calendarFacts} width={usable}>
          <Heatmap days={data.claude} ramp={ramp} today={data.todayDate} width={usable} />
          <box paddingTop={1} paddingLeft={4} flexShrink={0}>
            <HeatmapLegend ramp={ramp} />
          </box>
        </Section>
      ) : (
        <Muted>no history yet — the first rollup runs in the background</Muted>
      )}

      {twoUp ? (
        <box flexDirection="row" flexShrink={0}>
          <box width={leftWidth} flexDirection="column" flexShrink={0}>
            {left}
          </box>
          {/* Drawn as a border so it runs the full height of whichever column is
              taller, instead of a guessed number of rows. */}
          <box width={1} flexShrink={0} />
          <box
            border={BORDER_LEFT}
            borderColor={t.borderSubtle}
            paddingLeft={1}
            width={rightWidth + 2}
            flexDirection="column"
            flexShrink={0}
          >
            {right}
          </box>
        </box>
      ) : (
        <box flexDirection="column" flexShrink={0}>
          {left}
          {right}
        </box>
      )}

      {hasHistory ? (
        <Section
          glyph={GLYPH.tokens}
          title="Tokens"
          note={burn.days === 0 ? '' : `${formatUsd(burn.cost)} a day`}
          width={usable}
        >
          <VBarChart
            caption={`last ${chartDays} days`}
            format={formatCompact}
            values={dailyTokens}
          />
          <Muted>{costFacts}</Muted>
        </Section>
      ) : null}
    </box>
  )
}
