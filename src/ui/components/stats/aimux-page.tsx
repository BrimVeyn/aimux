/* eslint-disable react-perf/jsx-no-new-array-as-prop -- The row arrays are
   derived per render and `StatTable` is deliberately not memoized, so a stable
   identity would buy nothing: the rule guards memoized children. */
import type { StatsData } from './use-stats-data'

import { peakOf, summarizeCounter, sumOf } from '../../../services/aimux-counters/summary'
import { formatCompact } from '../../format-number'
import { formatCount, formatDayLabel, formatDuration, formatFingerDistance } from './format'
import {
  Columns,
  GLYPH,
  Muted,
  Panel,
  StatTable,
  StatTile,
  type TableColumn,
  TileRow,
} from './shared'

// Column sets are fixed, so they are built once at module scope.
const HEADLINE_COLUMNS: TableColumn[] = [
  { header: 'Time today' },
  { header: 'Daily average' },
  { header: 'Keys today' },
]
const BEST_COLUMNS: TableColumn[] = [
  { header: 'Longest day' },
  { header: 'On' },
  { header: 'Longest run' },
  { header: 'On' },
]
const KEYS_COLUMNS: TableColumn[] = [{ header: 'Most keystrokes' }, { header: 'On' }]
const BUILT_COLUMNS: TableColumn[] = [
  { header: 'Workspaces' },
  { header: 'Runs' },
  { header: 'Tabs' },
  { header: 'Splits' },
]
const MISC_COLUMNS: TableColumn[] = [
  { header: 'Snippets' },
  { header: 'Lines scrolled' },
  { header: 'Daemon restarts' },
]

export function AimuxPage({ data, width }: { data: StatsData; width: number }) {
  const { counters, today } = data
  if (Object.keys(counters).length === 0) {
    return <Muted>nothing counted yet — this starts the first time aimux runs with it</Muted>
  }

  const uptime = summarizeCounter(counters, 'uptimeMs', today)
  const keys = summarizeCounter(counters, 'keys', today)
  const longestRun = peakOf(counters, 'longestRunMs')
  const dailyUptime = uptime.days === 0 ? 0 : uptime.total / uptime.days

  const splitsVertical = sumOf(counters, 'splitsVertical')
  const splitsHorizontal = sumOf(counters, 'splitsHorizontal')
  const splits = splitsVertical + splitsHorizontal
  const tileWidth = Math.floor(width / 3)

  return (
    <box flexDirection="column">
      <TileRow>
        <StatTile
          glyph={GLYPH.clock}
          label="Time in aimux"
          value={formatDuration(uptime.total)}
          width={tileWidth}
        />
        <StatTile
          glyph={GLYPH.keyboard}
          label="Keystrokes"
          value={formatCount(keys.total)}
          width={tileWidth}
        />
        <StatTile
          glyph={GLYPH.distance}
          label="Distance"
          value={formatFingerDistance(keys.total)}
          width={width - tileWidth * 2}
        />
      </TileRow>

      <box paddingTop={1} flexShrink={0}>
        <StatTable
          columns={HEADLINE_COLUMNS}
          rows={[
            [formatDuration(uptime.today), formatDuration(dailyUptime), formatCount(keys.today)],
          ]}
        />
      </box>

      <Columns width={width}>
        <Panel glyph={GLYPH.clock} title="Best days" note="since counting started">
          <StatTable
            columns={BEST_COLUMNS}
            rows={[
              [
                formatDuration(uptime.best.value),
                formatDayLabel(uptime.best.day) || '—',
                formatDuration(longestRun.value),
                formatDayLabel(longestRun.day) || '—',
              ],
            ]}
          />
          <box paddingTop={1}>
            <StatTable
              columns={KEYS_COLUMNS}
              rows={[[formatCount(keys.best.value), formatDayLabel(keys.best.day) || '—']]}
            />
          </box>
          <Muted>A count and nothing else — no key identity is recorded.</Muted>
        </Panel>

        <Panel glyph={GLYPH.aimux} title="What you built" note="all time">
          <StatTable
            columns={BUILT_COLUMNS}
            rows={[
              [
                formatCount(sumOf(counters, 'workspacesCreated')),
                formatCount(sumOf(counters, 'runsStarted')),
                formatCount(sumOf(counters, 'tabsOpened')),
                splits === 0
                  ? '0'
                  : `${formatCount(splits)} (${Math.round((splitsVertical / splits) * 100)}% v)`,
              ],
            ]}
          />
          <box paddingTop={1}>
            <StatTable
              columns={MISC_COLUMNS}
              rows={[
                [
                  formatCount(sumOf(counters, 'snippetsFired')),
                  formatCompact(sumOf(counters, 'scrollLines')),
                  formatCount(sumOf(counters, 'daemonRestarts')),
                ],
              ]}
            />
          </box>
        </Panel>
      </Columns>
    </box>
  )
}
