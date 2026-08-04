import { dayCost, formatUsd } from '../../../services/usage-history/cost'
import {
  lastDays,
  lateNightPrompts,
  meanOf,
  peakDay,
  projectTotals,
  SESSION_BUCKETS,
  sessionLengths,
  sessionStats,
  streaks,
  totalMean,
} from '../../../services/usage-history/insights'
import { summarizeDays } from '../../../services/usage-history/stats'
import { formatCompact } from '../../format-number'
import { chartColumns } from './chart'
import { formatCount, formatDayLabel, formatDuration, shortenPath, weeklyLabels } from './format'
import {
  BarRow,
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
import { isEmpty, type StatsData } from './use-stats-data'

/**
 * Projects — where the work went and what a session looks like.
 *
 * Usage answers "how much"; this page answers "on what, and in what shape". The
 * session-length bars are the reason it exists: a median says where the middle
 * is, and the middle is the least interesting thing about a day made of one long
 * session or of twenty two-minute ones.
 */

/** Tall enough to read a week off, short enough to sit beside a list of bars. */
const CHART_HEIGHT = 7

/**
 * The median session length, or why it is zero.
 *
 * `formatDuration` renders nothing-at-all as an em dash, which is right for a
 * missing measurement and wrong here: with thousands of single-prompt sessions
 * the median really is zero, and "—" would report the most interesting fact on
 * the page as an absence of data.
 */
function medianLabel(count: number, medianMs: number): string {
  if (count === 0) return '\u{2014}'
  return medianMs <= 0 ? '< 1 min' : formatDuration(medianMs)
}

function projectTiles(
  projects: number,
  branches: number,
  sessions: number,
  typical: string
): PageTile[] {
  return [
    { glyph: GLYPH.projects, label: 'Projects', value: formatCount(projects) },
    { glyph: GLYPH.branches, label: 'Branches', value: formatCount(branches) },
    { glyph: GLYPH.sessions, label: 'Sessions', value: formatCount(sessions) },
    { glyph: GLYPH.clock, label: 'Typical', value: typical },
  ]
}

export function ProjectsPage({ data, width }: { data: StatsData; width: number }) {
  // First, before the derivations it would make pointless.
  if (isEmpty(data.claude)) {
    return <PageNotice>no history yet — the first rollup runs in the background</PageNotice>
  }

  const { split, usable } = pageLayout(width)
  const { leftWidth, rightWidth } = split

  const projects = projectTotals(data.claude, 8)
  const summary = summarizeDays(data.claude)
  const sessions = sessionStats(data.claude)
  const lengths = sessionLengths(data.claude)
  const promptChars = totalMean(data.claude, (day) => day.promptChars)
  const turns = totalMean(data.claude, (day) => day.turnMs)
  const streak = streaks(data.claude, data.todayDate)

  const projectMax = projects.entries[0]?.[1] ?? 0
  const branchMax = summary.branches[0]?.[1] ?? 0
  const lengthMax = Math.max(...lengths, 0)
  const perDay = sessions.days === 0 ? 0 : sessions.count / sessions.days

  const chartDays = chartColumns(rightWidth - 8)
  const daily = lastDays(
    data.claude,
    chartDays,
    data.todayDate,
    (day) => Object.keys(day.sessions).length
  )
  const chartLabels = weeklyLabels(chartDays, data.todayDate)

  const busiest = peakDay(data.claude, (day) => day.prompts)
  const richest = peakDay(data.claude, (day) => day.tokens.total)
  const priciest = peakDay(data.claude, (day) => dayCost(day).total)
  const lateNight = lateNightPrompts(data.claude)

  // Only records that exist. A row of `—` teaches nothing and reads as broken.
  const records = recordsOf([
    busiest.value === 0
      ? null
      : {
          label: 'Busiest day',
          value: `${formatCount(busiest.value)} prompts`,
          when: formatDayLabel(busiest.day),
        },
    streak.longest === 0
      ? null
      : { label: 'Longest streak', value: `${streak.longest} days`, when: '' },
    sessions.longestMs === 0
      ? null
      : {
          label: 'Longest session',
          value: formatDuration(sessions.longestMs),
          when: formatDayLabel(sessions.longestDay),
        },
    richest.value === 0
      ? null
      : {
          label: 'Most tokens',
          value: `${formatCompact(richest.value)} in a day`,
          when: formatDayLabel(richest.day),
        },
    priciest.value === 0
      ? null
      : {
          label: 'Priciest day',
          value: `${formatUsd(priciest.value)} est.`,
          when: formatDayLabel(priciest.day),
        },
    promptChars.max === 0
      ? null
      : { label: 'Longest prompt', value: `${formatCount(promptChars.max)} chars`, when: '' },
    lateNight === 0
      ? null
      : {
          label: 'Late nights',
          value: `${formatCount(lateNight)} prompts`,
          when: 'between 02:00 and 05:00',
        },
  ])

  const left = (
    <>
      <Section
        glyph={GLYPH.projects}
        title="Projects"
        note={projects.entries.length === 0 ? '' : `${formatCount(projects.total)} prompts`}
        width={leftWidth}
      >
        {projects.entries.length === 0 ? (
          <Muted>recorded from the next rollup onward</Muted>
        ) : (
          projects.entries.map(([path, value]) => (
            <BarRow
              key={path}
              label={shortenPath(path)}
              max={projectMax}
              value={value}
              valueText={formatCount(value)}
              width={leftWidth}
            />
          ))
        )}
      </Section>

      <Section
        glyph={GLYPH.sessions}
        title="Session length"
        note={
          sessions.count === 0 ? '' : `median ${medianLabel(sessions.count, sessions.medianMs)}`
        }
        width={leftWidth}
      >
        {sessions.count === 0 ? (
          <Muted>recorded from the next rollup onward</Muted>
        ) : (
          <>
            {SESSION_BUCKETS.map((label, index) => (
              <BarRow
                key={label}
                label={label}
                max={lengthMax}
                value={lengths[index] ?? 0}
                valueText={formatCount(lengths[index] ?? 0)}
                width={leftWidth}
              />
            ))}
            <Muted>
              {[
                `longest ${formatDuration(sessions.longestMs)}`,
                sessions.singlePrompt === 0
                  ? ''
                  : `${formatCount(sessions.singlePrompt)} one-prompt`,
                turns.count === 0 ? '' : `average turn ${formatDuration(meanOf(turns))}`,
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
        glyph={GLYPH.branches}
        title="Branches"
        note={summary.branchTotal === 0 ? '' : `${formatCompact(summary.branchTotal)} tokens`}
        width={rightWidth}
      >
        {summary.branches.length === 0 ? (
          <Muted>no branch attribution recorded</Muted>
        ) : (
          summary.branches.map(([branch, value]) => (
            <BarRow
              key={branch}
              label={branch}
              max={branchMax}
              value={value}
              valueText={formatCompact(value)}
              width={rightWidth}
            />
          ))
        )}
      </Section>

      <Section
        glyph={GLYPH.calendar}
        title="Sessions a day"
        note={sessions.count === 0 ? '' : `${perDay.toFixed(1)} on an active day`}
        width={rightWidth}
      >
        {sessions.count === 0 ? (
          <Muted>recorded from the next rollup onward</Muted>
        ) : (
          <>
            <VBarChart
              caption={`last ${chartDays} days`}
              height={CHART_HEIGHT}
              labels={chartLabels}
              values={daily}
            />
            <Muted>
              {[
                `${formatCount(sessions.count)} over ${formatCount(sessions.days)} days`,
                promptChars.count === 0 ? '' : `${formatCount(meanOf(promptChars))} chars a prompt`,
              ]
                .filter((part) => part !== '')
                .join(' \u{00B7} ')}
            </Muted>
          </>
        )}
      </Section>
    </>
  )

  return (
    <StatsPage
      tiles={projectTiles(
        projects.entries.length,
        summary.branches.length,
        sessions.count,
        medianLabel(sessions.count, sessions.medianMs)
      )}
      usable={usable}
    >
      <TwoColumn split={split}>
        {left}
        {right}
      </TwoColumn>

      <RecordsSection
        empty="nothing to beat yet — records appear as history accumulates"
        records={records}
        width={usable}
      />
    </StatsPage>
  )
}
