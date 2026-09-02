import { createTestContext } from '@brimveyn/aimux-plugin'
import { describe, expect, test } from 'bun:test'

import { createDoctorExtender, emptyRegistrations } from '../../src/plugins/doctor-services'

/**
 * `aimux plugin doctor` applies each half against a throwaway context so it can
 * report what a plugin registers without touching the running aimux. That only
 * works if the context has the services the plugin reaches for — a plugin
 * calling `ctx.ui.views.register` would otherwise fail on a missing property,
 * and doctor would report a broken plugin that is fine.
 */

describe('doctor host services', () => {
  test('a UI half s registrations are recorded rather than applied', async () => {
    const contributed = emptyRegistrations()
    const harness = createTestContext({
      extend: createDoctorExtender('ui', contributed),
      host: 'ui',
      id: 'acme.thing',
    })

    await harness.apply({
      apply(ctx) {
        const ui = ctx as unknown as {
          ui: {
            widgets: { register: (w: unknown) => void }
            views: { register: (v: unknown) => void }
            modals: { register: (m: unknown) => void }
            stats: { registerPage: (p: unknown) => void }
            themes: { register: (id: string, theme: unknown) => void }
            settings: { registerSection: (s: unknown) => void }
          }
          actions: {
            register: (v: string, h: unknown) => void
            effect: (id: string, h: unknown) => void
          }
          store: { reducer: (r: unknown) => void }
        }
        ui.ui.widgets.register({ id: 'board', label: 'Board', render: () => null })
        ui.ui.views.register({ id: 'board', render: () => null, title: 'Board' })
        ui.ui.modals.register({ id: 'confirm', render: () => null, title: 'Confirm' })
        ui.ui.stats.registerPage({ glyph: '◆', id: 'usage', label: 'Usage', render: () => null })
        ui.ui.themes.register('midnight', {})
        ui.ui.settings.registerSection({})
        ui.actions.register('open', () => null)
        ui.actions.effect('greet', () => {})
        ui.store.reducer(() => ({}))
      },
    })

    expect(contributed.widgets).toEqual(['board'])
    expect(contributed.views).toEqual(['board'])
    expect(contributed.modals).toEqual(['confirm'])
    expect(contributed.statsPages).toEqual(['usage'])
    expect(contributed.themes).toEqual(['midnight'])
    expect(contributed.settingsSections).toBe(1)
    expect(contributed.actions).toEqual(['open'])
    expect(contributed.effects).toEqual(['greet'])
    expect(contributed.storeReducer).toBe(true)
  })

  test('a daemon half s registrations are recorded', async () => {
    const contributed = emptyRegistrations()
    const harness = createTestContext({
      extend: createDoctorExtender('daemon', contributed),
      host: 'daemon',
      id: 'acme.thing',
    })

    await harness.apply({
      apply(ctx) {
        const daemon = ctx as unknown as {
          assistants: { register: (d: unknown) => void }
          hooks: { route: (id: string, fn: unknown) => void }
          cli: { register: (c: unknown) => void }
          tabs: { list: () => unknown[] }
        }
        daemon.assistants.register({ option: { id: 'acme.robot' } })
        daemon.hooks.route('events', () => {})
        daemon.cli.register({ group: 'acme', run: async () => ({}), summary: 'Ping', verb: 'ping' })
        // Reads answer emptily rather than throwing, so an `apply` that looks
        // around still completes.
        expect(daemon.tabs.list()).toEqual([])
      },
    })

    expect(contributed.assistants).toEqual(['acme.robot'])
    expect(contributed.hookRoutes).toEqual(['events'])
    expect(contributed.cliCommands).toEqual(['acme ping'])
  })

  test('a dry run refuses to spawn a tab', async () => {
    const harness = createTestContext({
      extend: createDoctorExtender('daemon', emptyRegistrations()),
      host: 'daemon',
      id: 'acme.thing',
    })
    const spawn = (harness.ctx as unknown as { tabs: { spawn: () => Promise<string> } }).tabs.spawn
    // An `apply` that spawns a tab is doing work, not registering. Doctor says
    // so rather than quietly handing back a fake id the plugin then uses.
    expect(spawn()).rejects.toThrow(/does not spawn tabs/)
  })

  test('unregistering during apply is reflected in the report', async () => {
    const contributed = emptyRegistrations()
    const harness = createTestContext({
      extend: createDoctorExtender('ui', contributed),
      host: 'ui',
      id: 'acme.thing',
    })

    await harness.apply({
      apply(ctx) {
        const ui = ctx as unknown as {
          ui: { widgets: { register: (w: unknown) => () => void } }
        }
        const dispose = ui.ui.widgets.register({ id: 'temp', label: 'Temp', render: () => null })
        dispose()
      },
    })

    expect(contributed.widgets).toEqual([])
  })
})
