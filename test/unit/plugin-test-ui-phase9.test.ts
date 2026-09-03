import { createTestContext, type UiPluginContext } from '@brimveyn/aimux-plugin'
import { describe, expect, test } from 'bun:test'

/**
 * The recording UI half knows the phase 9 surfaces: a plugin written against
 * `layout`, `notifications`, git writes or `registerCommand` can be tested
 * with nothing but `bun install`.
 */
describe('the test UI surface, phase 9', () => {
  test('records command panes, layout verbs, git writes and the notification slot', async () => {
    const t = createTestContext({ host: 'ui', id: 'acme.tools' })
    await t.apply<UiPluginContext>({
      apply(ctx) {
        ctx.ui.panes.registerCommand({ command: ['lazygit'], id: 'lazygit', title: 'lazygit' })
        ctx.ui.layout.split('vertical')
        ctx.ui.layout.swap('left')
        ctx.ui.notifications.provide(() => {})
        ctx.ui.notifications.notify({ title: 'hello' })
        ctx.actions.register('open', () => null, { title: 'Open lazygit' })
        void ctx.ui.git.stage(['a.ts'])
      },
    })
    const ui = t.ui
    expect(ui?.registrations.commandPanes).toEqual(['lazygit'])
    expect(ui?.layoutCalls).toEqual(['split:vertical', 'swap:left'])
    expect(ui?.registrations.notificationSink).toBe(true)
    expect(ui?.notifications).toEqual([{ title: 'hello' }])
    expect(ui?.gitWrites).toEqual(['stage:a.ts'])
    await ui?.deliverNotification({ kind: 'turn-complete', title: 'Claude' })

    await t.dispose()
    expect(t.effectCount()).toBe(0)
    expect(ui?.registrations.commandPanes).toEqual([])
    expect(ui?.registrations.notificationSink).toBe(false)
  })
})
