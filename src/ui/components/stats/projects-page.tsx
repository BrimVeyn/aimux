/* eslint-disable react-perf/jsx-no-new-array-as-prop -- The row arrays are
   derived per render and `StatTable` is deliberately not memoized, so a stable
   identity would buy nothing: the rule guards memoized children. */
import {
  meanOf,
  projectTotals,
  sessionStats,
  totalMean,
} from '../../../services/usage-history/insights'
import { summarizeDays } from '../../../services/usage-history/stats'
import { formatCompact } from '../../format-number'
import { formatCount, formatDayLabel, formatDuration } from './format'
import {
  BarRow,
  Columns,
  GLYPH,
  Muted,
  Panel,
  StatTable,
  StatTile,
  type TableColumn,
  TileRow,
} from './shared'
import { isEmpty, type StatsData } from './use-stats-data'

// Column sets are fixed, so they are built once at module scope.
const HEADLINE_COLUMNS: TableColumn[] = [
  { header: 'Sessions / day' },
  { header: 'Median length' },
  { header: 'Average turn' },
]
const SESSION_COLUMNS: TableColumn[] = [
  { header: 'Longest session' },
  { header: 'Single-prompt' },
  { header: 'Prompt length' },
  { header: 'Longest prompt' },
]

/** The last two path segments — `Documents/aimux` says more than `aimux` and still fits. */
function shortenPath(path: string): string {
  return path
    .split('/')
    .filter((part) => part !== '')
    .slice(-2)
    .join('/')
}

export function ProjectsPage({ data, width }: { data: StatsData; width: number }) {
  if (isEmpty(data.claude)) {
    return <Muted>no history yet — the first rollup runs in the background</Muted>
  }

  const projects = projectTotals(data.claude, 8)
  const summary = summarizeDays(data.claude)
  const sessions = sessionStats(data.claude)
  const promptChars = totalMean(data.claude, (day) => day.promptChars)
  const turns = totalMean(data.claude, (day) => day.turnMs)

  const projectMax = projects.entries[0]?.[1] ?? 0
  const branchMax = summary.branches[0]?.[1] ?? 0
  const perDay = sessions.days === 0 ? 0 : sessions.count / sessions.days
  const tileWidth = Math.floor(width / 3)

  return (
    <box flexDirection="column">
      <TileRow>
        <StatTile
          glyph={GLYPH.projects}
          label="Projects"
          value={formatCount(projects.entries.length)}
          width={tileWidth}
        />
        <StatTile
          glyph={GLYPH.branches}
          label="Branches"
          value={formatCount(summary.branches.length)}
          width={tileWidth}
        />
        <StatTile
          glyph={GLYPH.sessions}
          label="Sessions"
          value={formatCount(sessions.count)}
          width={width - tileWidth * 2}
        />
      </TileRow>

      <box paddingTop={1} flexShrink={0}>
        <StatTable
          columns={HEADLINE_COLUMNS}
          rows={[
            [
              perDay.toFixed(1),
              sessions.count === 0 ? '—' : formatDuration(sessions.medianMs),
              turns.count === 0 ? '—' : formatDuration(meanOf(turns)),
            ],
          ]}
        />
      </box>

      <Columns width={width}>
        <Panel
          glyph={GLYPH.projects}
          title="Projects"
          note={
            projects.entries.length === 0 ? 'no data' : `${formatCount(projects.total)} prompts`
          }
        >
          {projects.entries.length === 0 ? (
            <Muted>recorded from the next rollup onward</Muted>
          ) : (
            projects.entries.map(([path, value]) => (
              <BarRow
                key={path}
                label={shortenPath(path)}
                max={projectMax}
                total={projects.total}
                value={value}
                valueText={formatCount(value)}
              />
            ))
          )}
        </Panel>

        <Panel
          glyph={GLYPH.branches}
          title="Branches"
          note={`${formatCompact(summary.branchTotal)} tokens`}
        >
          {summary.branches.length === 0 ? (
            <Muted>no branch attribution recorded</Muted>
          ) : (
            summary.branches.map(([branch, value]) => (
              <BarRow
                key={branch}
                label={branch}
                max={branchMax}
                total={summary.branchTotal}
                value={value}
                valueText={formatCompact(value)}
              />
            ))
          )}
        </Panel>
      </Columns>

      <Panel
        glyph={GLYPH.sessions}
        title="Sessions and prompts"
        note={sessions.count === 0 ? 'no data' : formatDayLabel(sessions.longestDay)}
      >
        {sessions.count === 0 ? (
          <Muted>recorded from the next rollup onward</Muted>
        ) : (
          <StatTable
            columns={SESSION_COLUMNS}
            rows={[
              [
                formatDuration(sessions.longestMs),
                formatCount(sessions.singlePrompt),
                promptChars.count === 0 ? '—' : `${Math.round(meanOf(promptChars))} chars`,
                promptChars.count === 0 ? '—' : formatCount(promptChars.max),
              ],
            ]}
          />
        )}
      </Panel>
    </box>
  )
}
