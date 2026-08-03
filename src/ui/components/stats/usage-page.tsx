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
import { localDay } from '../../../services/usage-history/store'
import { formatCompact } from '../../format-number'
import { useTheme } from '../../theme'
import { chartColumns, fitShape } from './chart'
import { formatClock, formatCount, formatDayLabel, formatPercent } from './format'
import { Heatmap, HeatmapLegend, heatmapWidth, useHeatmapRamp } from './heatmap'
import { QuotaSection } from './quotas'
import { BarRow, GLYPH, Muted, Rule, Section, StatTile, TileRow, VBarChart } from './shared'
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

/**
 * Every fourth hour, at module scope so the ruler is not a fresh array each frame.
 *
 * Six labels rather than twenty-four: the reader is looking for where the mass
 * of the day sits, and a number under every column would draw more ink than the
 * columns do.
 */
const HOUR_LABELS = Array.from({ length: 24 }, (_, hour) =>
  hour % 4 === 0 ? String(hour).padStart(2, '0') : ''
)
/** Tall enough to show the shape of a day, short enough to sit under Quotas. */
const HOUR_HEIGHT = 6

/**
 * `claude-haiku-4-5-20251001` as `haiku-4-5`. The vendor prefix is the same on
 * every row and the release date is a build stamp, not something a reader is
 * comparing models on.
 */
function modelLabel(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

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

  // Both charts reserve the same eight columns for the axis and its gutter, so
  // the hours and the days start on the same column of their sections.
  const hourShape = fitShape(hours.length, leftWidth - 8)
  const chartDays = chartColumns(usable - 8)
  const dailyTokens = lastDays(data.claude, chartDays, data.todayDate, (day) => day.tokens.total)
  // A date every seventh bar, so the ruler reads as weeks and the labels have
  // room to breathe rather than colliding into a smear.
  const chartLabels = Array.from({ length: chartDays }, (_, index) => {
    if ((chartDays - 1 - index) % 7 !== 0) return ''
    const date = new Date(data.todayDate)
    date.setDate(date.getDate() - (chartDays - 1 - index))
    return formatDayLabel(localDay(date))
  })

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
            <VBarChart
              bar={hourShape}
              format={formatCompact}
              height={HOUR_HEIGHT}
              labels={HOUR_LABELS}
              values={hours}
            />
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
              label={modelLabel(model)}
              max={modelMax}
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
        <Section
          glyph={GLYPH.calendar}
          title="Activity"
          note={<HeatmapLegend ramp={ramp} />}
          rule={false}
          // The calendar's own width, not the pane's: the legend belongs over
          // the grid's top-right corner, and the grid is only as wide as the
          // history is long. This section draws no rule, so nothing else uses it.
          width={heatmapWidth(data.claude, data.todayDate, usable)}
        >
          <Heatmap
            days={data.claude}
            ramp={ramp}
            summary={calendarFacts}
            today={data.todayDate}
            width={usable}
          />
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
            labels={chartLabels}
            values={dailyTokens}
          />
          <Muted>{costFacts}</Muted>
        </Section>
      ) : null}
    </box>
  )
}
