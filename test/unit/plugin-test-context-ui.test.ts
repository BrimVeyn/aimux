import { createTestContext, definePlugin } from '@brimveyn/aimux-plugin'
import { describe, expect, test } from 'bun:test'

/**
 * `createTestContext` with no `extend`, which is the only form a plugin author
 * outside this repo can write.
 *
 * The bug this pins down was invisible from inside aimux: every test here
 * passes `extend` with the real services, so nobody noticed that a bare `ui`
 * context had no `ctx.ui` at all. The plugin `aimux plugin new` scaffolds
 * registers a widget on its first line, so the test it scaffolds alongside it
 * threw — an author's first `bun test` was a red they had not written.
 */

describe('a UI half against a bare test context', () => {
  test('applies, records what it registered, and unloads clean', async () => {
    const harness = createTestContext({ host: 'ui', id: 'acme.thing' })

    await harness.apply(
      definePlugin({
        apply(context) {
          const ctx = context as typeof context & {
            ui: { widgets: { register: (w: unknown) => unknown } }
            actions: { register: (verb: string, handler: () => unknown) => unknown }
          }
          ctx.ui.widgets.register({ id: 'panel', label: 'Panel', render: () => null })
          ctx.actions.register('open', () => null)
        },
      })
    )

    expect(harness.ui?.registrations.widgets).toEqual(['panel'])
    expect(harness.ui?.registrations.actions).toEqual(['open'])

    // The property every plugin test is really there to check.
    await harness.dispose()
    expect(harness.effectCount()).toBe(0)
    expect(harness.ui?.registrations.widgets).toEqual([])
  })

  test('the levers drive what the plugin reads back', async () => {
    const harness = createTestContext({ host: 'ui', id: 'acme.thing' })
    const seen: (string | null)[] = []

    await harness.apply(
      definePlugin({
        apply(context) {
          const ctx = context as typeof context & {
            ui: {
              state: { subscribe: (fn: (s: { activeTabId: string | null }) => void) => unknown }
              toast: { info: (message: string) => void }
            }
          }
          ctx.ui.state.subscribe((state) => seen.push(state.activeTabId))
          ctx.ui.toast.info('hello')
        },
      })
    )

    // `subscribe` fires once immediately, as the real one does.
    expect(seen).toEqual([null])
    harness.ui?.setState({ activeTabId: 't1' })
    expect(seen).toEqual([null, 't1'])
    expect(harness.ui?.toasts).toEqual([{ level: 'info', message: 'hello' }])

    await harness.dispose()
    harness.ui?.setState({ activeTabId: 't2' })
    expect(seen).toEqual([null, 't1'])
  })

  test('a daemon context still has no ui surface to record', () => {
    expect(createTestContext({ host: 'daemon', id: 'acme.thing' }).ui).toBeUndefined()
  })
})
