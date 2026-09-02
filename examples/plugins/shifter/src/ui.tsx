import { definePlugin, type UiPluginContext } from '@brimveyn/aimux-plugin'

import { gearAt, GEARS, shift } from './gears'

/**
 * A five-speed gearbox for the model the active assistant runs on.
 *
 * The shape worth copying: a tile that shows state, two keybindings that
 * change it, and one RPC call to the half that can act. The gear lives in
 * `ctx.store` — the plugin's own slice of the app state — so it survives a
 * re-render, and the tile reads it back through the same store.
 */

interface Slice {
  gear: number
  /** Set when the assistant refused, cleared on the next successful shift. */
  error: string | null
}

const EMPTY: Slice = { error: null, gear: 3 }

export default definePlugin({
  apply(context) {
    // Typed on the slice: `UiPluginContext<Slice>` is what makes
    // `ctx.store.get()` return something other than `unknown`.
    const ctx = context as UiPluginContext<Slice>

    ctx.store.reducer((slice = EMPTY, action) => {
      switch (action.actionId) {
        case 'set':
          return { error: null, gear: action.payload as number }
        case 'failed':
          return { ...slice, error: action.payload as string }
        default:
          return slice
      }
    })

    const currentGear = (): number => ctx.store.get()?.gear ?? EMPTY.gear

    /**
     * Ask the daemon half to type it. Registered as an effect rather than done
     * in the action, because an action decides and an effect is the side that
     * is allowed to do things — including, here, to fail.
     */
    ctx.actions.effect('engage', async (payload) => {
      const gear = payload as number
      const tabId = ctx.ui.state.get().activeTabId
      if (tabId === null) {
        ctx.ui.toast.error('shifter: no active tab')
        return
      }

      ctx.store.dispatch('set', gear)
      const result = await ctx.rpc.call<{ engaged: boolean; reason?: string }>('engage', {
        gear,
        tabId,
      })
      if (!result.engaged) {
        ctx.store.dispatch('failed', result.reason ?? 'refused')
        ctx.ui.toast.error(`shifter: ${result.reason ?? 'refused'}`)
      }
    })

    const bind = (verb: string, next: () => number): void => {
      ctx.actions.register(verb, () => ({
        actions: [],
        effects: [{ effectId: 'engage', payload: next(), pluginId: ctx.id, type: 'plugin-effect' }],
      }))
    }

    bind('up', () => shift(currentGear(), 1))
    bind('down', () => shift(currentGear(), -1))
    for (const gear of GEARS) bind(`gear${gear.index}`, () => gear.index)

    ctx.ui.statusBar.register({
      id: 'gear',
      render: () => {
        const { Row } = ctx.ui.kit
        const theme = ctx.ui.kit.useTheme()
        // The hook, not `state.get()`: this is a component, and it has to
        // re-render when the user shifts.
        const slice = ctx.store.get() ?? EMPTY
        const gear = gearAt(slice.gear)
        return (
          <Row
            label={
              <text fg={slice.error === null ? theme.text : theme.error}>{`⚙ ${gear.index}`}</text>
            }
            value={<text fg={theme.textMuted}>{gear.label}</text>}
          />
        )
      },
    })

    ctx.log.info('shifter ready', { gears: GEARS.length })
  },
})
