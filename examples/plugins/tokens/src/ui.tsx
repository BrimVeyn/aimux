import { definePlugin, type PluginNode, type UiPluginContext } from '@brimveyn/aimux-plugin'

import { family, type TabUsage, tokens } from './usage'

/**
 * A tile for the tab in front of you, a stats page for all of them, one key
 * to resume the conversation in a fresh tab, and one warning when a tab has
 * spent more than you said it may.
 *
 * The daemon half pushes on every finished turn; this half asks once for any
 * tab it has not heard about, which is what makes the tile right on the first
 * switch rather than the first turn.
 */

interface Slice {
  byTab: Record<string, TabUsage>
  /** Tabs already warned. A threshold crossed once is crossed for good. */
  warned: string[]
}

const EMPTY: Slice = { byTab: {}, warned: [] }

export default definePlugin({
  apply(context) {
    const ctx = context as UiPluginContext<Slice>
    const warnAt = typeof ctx.config.warnAt === 'number' ? ctx.config.warnAt : 0

    ctx.store.reducer((slice = EMPTY, action) => {
      switch (action.actionId) {
        case 'usage': {
          const entry = action.payload as TabUsage
          return { ...slice, byTab: { ...slice.byTab, [entry.usage.tabId]: entry } }
        }
        case 'warned':
          return { ...slice, warned: [...slice.warned, action.payload as string] }
        case 'forget': {
          const { [action.payload as string]: _gone, ...rest } = slice.byTab
          return { ...slice, byTab: rest }
        }
        default:
          return slice
      }
    })

    const received = (entry: TabUsage): void => {
      ctx.store.dispatch('usage', entry)
      const { tabId, total } = entry.usage
      if (warnAt <= 0 || total < warnAt || (ctx.store.get()?.warned ?? []).includes(tabId)) return
      ctx.store.dispatch('warned', tabId)
      // Through `notify`: if a plugin holds the notification slot, this lands
      // on the phone with everything else, and otherwise it is a toast.
      ctx.ui.notifications.notify({
        level: 'warning',
        message: `${tokens(total)} tokens over ${entry.usage.turns} turns — time to hand off?`,
        title: 'Tokens',
      })
    }

    ctx.rpc.handle('usage', (payload) => {
      received(payload as TabUsage)
    })

    const ask = async (tabId: string): Promise<void> => {
      try {
        const entry = await ctx.rpc.call<TabUsage | null>('usage', { tabId })
        if (entry !== null) received(entry)
      } catch (error) {
        ctx.log.warn('usage unavailable', { error: String(error), tabId })
      }
    }

    // Ask for the active tab once, and again whenever it changes to one we
    // have not seen. Closed tabs are forgotten so the slice does not grow
    // with the day.
    // Asked once per tab, whatever the answer: a tab without a transcript
    // would otherwise be asked again on every state change, which is many
    // times a second while an agent types.
    const asked = new Set<string>()
    ctx.effect(() =>
      ctx.ui.state.subscribe((state) => {
        if (state.activeTabId !== null && !asked.has(state.activeTabId)) {
          asked.add(state.activeTabId)
          void ask(state.activeTabId)
        }
        const open = new Set(state.tabs.map((tab) => tab.id))
        for (const tabId of asked) if (!open.has(tabId)) asked.delete(tabId)
        for (const tabId of Object.keys(ctx.store.get()?.byTab ?? {})) {
          if (!open.has(tabId)) ctx.store.dispatch('forget', tabId)
        }
      })
    )

    ctx.actions.effect('resume', async () => {
      const tabId = ctx.ui.state.get().activeTabId
      if (tabId === null) {
        ctx.ui.toast.error('tokens: no active tab')
        return
      }
      const result = await ctx.rpc.call<{ resumed: boolean; reason?: string }>('resume', { tabId })
      if (result.resumed) ctx.ui.toast.success('resumed in a fresh tab')
      else ctx.ui.toast.error(`tokens: ${result.reason ?? 'could not resume'}`)
    })
    ctx.actions.register(
      'resume',
      () => ({
        actions: [],
        effects: [{ effectId: 'resume', pluginId: ctx.id, type: 'plugin-effect' }],
      }),
      {
        description:
          'Close this tab and reopen the same conversation — after a crash or a rate limit',
        title: 'Resume this conversation',
      }
    )

    function Tile(): PluginNode {
      const { Row } = ctx.ui.kit
      const theme = ctx.ui.kit.useTheme()
      const activeTabId = ctx.ui.state.use((state) => state.activeTabId)
      const slice = ctx.store.use() ?? EMPTY
      const entry = activeTabId === null ? undefined : slice.byTab[activeTabId]
      if (!entry) return <text fg={theme.textMuted}>{'⌁ —'}</text>
      const over = warnAt > 0 && entry.usage.total >= warnAt
      return (
        <Row
          label={
            <text fg={over ? theme.warning : theme.text}>{`⌁ ${tokens(entry.usage.total)}`}</text>
          }
          value={<text fg={theme.textMuted}>{family(entry.session.model)}</text>}
        />
      )
    }

    ctx.ui.statusBar.register({ id: 'spent', render: () => <Tile /> })

    function Page(): PluginNode {
      const { Panel, Row } = ctx.ui.kit
      const theme = ctx.ui.kit.useTheme()
      const tabs = ctx.ui.state.use((state) => state.tabs)
      const slice = ctx.store.use() ?? EMPTY
      const known = tabs.filter((tab) => tab.id in slice.byTab)

      return (
        <box flexDirection="column" flexGrow={1}>
          {known.length === 0 ? (
            <text fg={theme.textMuted}>no tab with a transcript yet</text>
          ) : (
            known.map((tab) => {
              const entry = slice.byTab[tab.id]
              if (!entry) return null
              const { session, usage } = entry
              return (
                <Panel key={tab.id} title={tab.title}>
                  <Row label="Model" value={session.model ?? '—'} dim={session.model === null} />
                  <Row label="Turns" value={`${usage.turns}`} />
                  <Row label="Input" value={tokens(usage.input)} />
                  <Row label="Output" value={tokens(usage.output)} />
                  <Row label="Cache read" value={tokens(usage.cacheRead)} />
                  <Row label="Cache write" value={tokens(usage.cacheWrite)} />
                  <Row label="Total" value={tokens(usage.total)} />
                  <Row
                    label="Session"
                    value={session.sessionId ?? 'none'}
                    dim={session.sessionId === null}
                  />
                </Panel>
              )
            })
          )}
        </box>
      )
    }

    ctx.ui.stats.registerPage({ glyph: '⌁', id: 'tokens', label: 'Tokens', render: () => <Page /> })
  },
})
