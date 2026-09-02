import {
  definePlugin,
  type PluginCounterDay,
  type PluginNode,
  type UiPluginContext,
} from '@brimveyn/aimux-plugin'

/**
 * A pane, not a view: it sits *beside* the agent rather than covering it,
 * which is the whole reason panes exist.
 *
 * Two sources in one screen — what aimux recorded (from the daemon, on a
 * timer) and what it is doing right now (`ctx.ui.state`, live).
 */

interface Slice {
  days: PluginCounterDay[]
  error: string | null
}

const EMPTY: Slice = { days: [], error: null }

/** The counters worth a line, in the order a person would read them. */
const ROWS: readonly { key: string; label: string }[] = [
  { key: 'tabsOpened', label: 'Tabs opened' },
  { key: 'keys', label: 'Keys pressed' },
  { key: 'scrollLines', label: 'Lines scrolled' },
  { key: 'splitsVertical', label: 'Splits ' },
  { key: 'snippetsFired', label: 'Snippets' },
  { key: 'workspacesCreated', label: 'Workspaces' },
]

function total(days: readonly PluginCounterDay[], key: string): number {
  return days.reduce((sum, day) => sum + (day.values[key] ?? 0), 0)
}

/** `93600000` → `26h`. Uptime is the one counter that is not a count. */
function hours(ms: number): string {
  return `${Math.round(ms / 3_600_000)}h`
}

export default definePlugin({
  apply(context) {
    const ctx = context as UiPluginContext<Slice>

    ctx.store.reducer((slice = EMPTY, action) => {
      switch (action.actionId) {
        case 'loaded':
          return { days: action.payload as PluginCounterDay[], error: null }
        case 'failed':
          return { ...slice, error: action.payload as string }
        default:
          return slice
      }
    })

    const refresh = async (): Promise<void> => {
      try {
        ctx.store.dispatch('loaded', await ctx.rpc.call<PluginCounterDay[]>('counters'))
      } catch (error) {
        ctx.store.dispatch('failed', error instanceof Error ? error.message : String(error))
      }
    }

    ctx.effect(() => {
      void refresh()
      const timer = setInterval(() => {
        void refresh()
      }, 60_000)
      return () => {
        clearInterval(timer)
      }
    })

    function Now(): PluginNode {
      const { Row } = ctx.ui.kit
      const theme = ctx.ui.kit.useTheme()
      // The live half. `use` re-renders this on every tab change, and only on
      // the ones that change what it selects.
      const tabs = ctx.ui.state.use((state) => state.tabs)
      const active = ctx.ui.state.use((state) => state.activeTab)
      const working = tabs.filter((tab) => tab.activity === 'working').length

      return (
        <box flexDirection="column">
          <Row label="Open tabs" value={`${tabs.length}`} />
          <Row
            label="Working"
            value={<text fg={working > 0 ? theme.accent : theme.textMuted}>{`${working}`}</text>}
          />
          <Row label="In front of you" value={active?.title ?? '—'} dim={active === null} />
        </box>
      )
    }

    function Recorded(): PluginNode {
      const { Row } = ctx.ui.kit
      const theme = ctx.ui.kit.useTheme()
      const slice = ctx.store.use() ?? EMPTY

      if (slice.days.length === 0) {
        return <text fg={theme.textMuted}>{slice.error ?? 'no counters yet'}</text>
      }

      return (
        <box flexDirection="column">
          {ROWS.map((row) => (
            <Row key={row.key} label={row.label} value={`${total(slice.days, row.key)}`} />
          ))}
          <Row label="Time in aimux" value={hours(total(slice.days, 'uptimeMs'))} />
          <text fg={theme.textMuted}>{`over ${slice.days.length} days`}</text>
        </box>
      )
    }

    function PulsePane(): PluginNode {
      const { Panel } = ctx.ui.kit
      return (
        <box flexDirection="column" flexGrow={1}>
          <Panel title="Right now">
            <Now />
          </Panel>
          <Panel title="Recorded" flexGrow={1}>
            <Recorded />
          </Panel>
        </box>
      )
    }

    ctx.ui.panes.register({ id: 'stats', render: () => <PulsePane />, title: 'Pulse' })

    // A pane is registered and then opened; registering does not put it on
    // screen, so the plugin ships the key that does.
    ctx.actions.effect('toggle', () => {
      ctx.ui.panes.open('stats', 'vertical')
    })
    ctx.actions.register('open', () => ({
      actions: [],
      effects: [{ effectId: 'toggle', pluginId: ctx.id, type: 'plugin-effect' }],
    }))
    ctx.actions.effect('hide', () => {
      ctx.ui.panes.close('stats')
    })
    ctx.actions.register('close', () => ({
      actions: [],
      effects: [{ effectId: 'hide', pluginId: ctx.id, type: 'plugin-effect' }],
    }))
  },
})
