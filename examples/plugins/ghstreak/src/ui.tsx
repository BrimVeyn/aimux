import { definePlugin, type PluginNode, type UiPluginContext } from '@brimveyn/aimux-plugin'

import { buildGrid, busiestDay, type Calendar, EMPTY_CALENDAR, level } from './calendar'

/**
 * A year of commits as a grid.
 *
 * Everything that touches a subprocess is in the daemon half; this one asks,
 * draws, and asks again on a timer.
 */

interface Slice {
  calendar: Calendar
  /** Set when the last refresh failed. The old grid keeps showing under it. */
  error: string | null
}

const EMPTY: Slice = { calendar: EMPTY_CALENDAR, error: null }

/** Cell glyphs by level. Two columns per week reads better than one. */
const CELLS = ['·', '▪', '▣', '█'] as const

export default definePlugin({
  apply(context) {
    const ctx = context as UiPluginContext<Slice>
    const refreshMinutes =
      typeof ctx.config.refreshMinutes === 'number' ? ctx.config.refreshMinutes : 30

    ctx.store.reducer((slice = EMPTY, action) => {
      switch (action.actionId) {
        case 'loaded':
          return { calendar: action.payload as Calendar, error: null }
        case 'failed':
          return { ...slice, error: action.payload as string }
        default:
          return slice
      }
    })

    const refresh = async (): Promise<void> => {
      try {
        const calendar = await ctx.rpc.call<Calendar>('calendar', {
          projectId: ctx.ui.state.get().projectId,
        })
        ctx.store.dispatch('loaded', calendar)
      } catch (error) {
        ctx.store.dispatch('failed', error instanceof Error ? error.message : String(error))
      }
    }

    ctx.effect(() => {
      void refresh()
      const timer = setInterval(
        () => {
          void refresh()
        },
        Math.max(1, refreshMinutes) * 60_000
      )
      return () => {
        clearInterval(timer)
      }
    })

    function Grid({ calendar, weeks }: { calendar: Calendar; weeks: number }): PluginNode {
      const theme = ctx.ui.kit.useTheme()
      const shades = [theme.backgroundElement, theme.textMuted, theme.accent, theme.success]
      const grid = buildGrid(calendar.counts, new Date(), weeks)
      const busiest = busiestDay(calendar.counts)

      // Seven rows, one per weekday, each drawn across every week — which is
      // the transpose of how the data arrives, and the only reason this is not
      // a one-liner.
      return (
        <box flexDirection="column">
          {[0, 1, 2, 3, 4, 5, 6].map((weekday) => (
            <box key={weekday} flexDirection="row">
              {grid.map((week) => {
                const cell = week[weekday]
                if (cell === undefined) return null
                const shade = cell.future ? 0 : level(cell.count, busiest)
                return (
                  <text
                    key={cell.day}
                    fg={cell.future ? theme.background : (shades[shade] ?? theme.textMuted)}
                  >
                    {cell.future ? ' ' : CELLS[shade]}
                  </text>
                )
              })}
            </box>
          ))}
        </box>
      )
    }

    function StreakPanel({ contentWidth }: { contentWidth: number }): PluginNode {
      const { Panel, Row } = ctx.ui.kit
      const theme = ctx.ui.kit.useTheme()
      const slice = ctx.store.use() ?? EMPTY
      const { calendar } = slice
      const weeks = Math.max(4, Math.min(53, contentWidth - 4))

      return (
        <Panel title="Commits">
          <Row
            label={
              <text fg={theme.text}>{calendar.label === '' ? 'loading…' : calendar.label}</text>
            }
            value={<text fg={theme.textMuted}>{`${calendar.total}`}</text>}
          />
          <Grid calendar={calendar} weeks={weeks} />
          {slice.error === null ? null : <text fg={theme.error}>{slice.error}</text>}
          {calendar.source === 'git' ? (
            // Say which grid this is. A local repo's history and an account's
            // contributions are different claims and should not look alike.
            <text fg={theme.textMuted}>this repo only</text>
          ) : null}
        </Panel>
      )
    }

    ctx.ui.widgets.register({
      id: 'commits',
      label: 'Commits',
      render: (contentWidth) => <StreakPanel contentWidth={contentWidth} />,
    })
  },
})
