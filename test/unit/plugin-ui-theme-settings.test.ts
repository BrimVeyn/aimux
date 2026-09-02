import {
  createTestContext,
  type PluginSettingValue,
  type PluginUiApi,
} from '@brimveyn/aimux-plugin'
import { afterEach, describe, expect, test } from 'bun:test'

import { settingsStore } from '../../src/settings/settings-store'
import { extendUiPluginContext } from '../../src/ui/plugin-ui-services'
import { applyTheme, getCurrentThemeId, setMode } from '../../src/ui/theme-store'

/**
 * Two services the first built-in migration asked for and did not find.
 *
 * A plugin that bridges aimux's theme into another program needs the palette
 * outside React, and a plugin replacing a feature the user already has a
 * toggle for must read *that* toggle rather than invent a second one. Both are
 * things a third-party plugin wants for the same reasons, which is the test
 * that a hole found by dogfooding was worth filling rather than working
 * around.
 */

function harness(): {
  ui: PluginUiApi
  dispose: () => Promise<unknown>
  apply: (definition: { apply: (ctx: unknown) => void }) => Promise<unknown>
} {
  const handle = createTestContext({ extend: extendUiPluginContext, host: 'ui', id: 'acme.bridge' })
  return {
    apply: async (definition) =>
      handle.apply(definition as Parameters<typeof handle.apply>[0]) as Promise<unknown>,
    dispose: async () => handle.dispose(),
    ui: (handle.ctx as unknown as { ui: PluginUiApi }).ui,
  }
}

const originalThemeId = getCurrentThemeId()

afterEach(() => {
  settingsStore.setState({ values: {} })
  applyTheme(originalThemeId)
  setMode('dark')
})

describe('ctx.ui.themes outside React', () => {
  test('current() returns the resolved palette and the mode', () => {
    setMode('dark')
    const { ui } = harness()
    const snapshot = ui.themes.current()

    expect(snapshot.mode).toBe('dark')
    // Flat colour tokens — the same values `kit.useTheme()` hands a component.
    expect(typeof snapshot.colors.accent).toBe('string')
  })

  test('onChange fires on a theme switch and stops on unload', async () => {
    const seen: string[] = []
    const h = harness()
    await h.apply({
      apply(ctx) {
        ;(ctx as { ui: PluginUiApi }).ui.themes.onChange((snapshot) => {
          seen.push(snapshot.mode)
        })
      },
    })

    setMode('light')
    expect(seen).toEqual(['light'])

    await h.dispose()
    setMode('dark')
    // The subscription went on the fiber, so the unload took it off.
    expect(seen).toEqual(['light'])
  })
})

describe('ctx.ui.settings against aimux own rows', () => {
  test('get reads a row by the id the user writes in their config', () => {
    settingsStore.setState({ values: { 'theme.beta.harmonizeClaudeTheme': true } })
    const { ui } = harness()

    expect(ui.settings.get('theme.beta.harmonizeClaudeTheme')).toBe(true)
    expect(ui.settings.get('nothing.set.here')).toBeUndefined()
  })

  test('watch fires once immediately, then on every change', async () => {
    const seen: PluginSettingValue[] = []
    const h = harness()
    await h.apply({
      apply(ctx) {
        ;(ctx as { ui: PluginUiApi }).ui.settings.watch('integrations.claudeHooks', (value) => {
          seen.push(value)
        })
      },
    })

    // The immediate call is the point: gating on a toggle is one call.
    expect(seen).toEqual([undefined])

    settingsStore.setState({ values: { 'integrations.claudeHooks': true } })
    settingsStore.setState({ values: { 'integrations.claudeHooks': true, 'other': 1 } })
    settingsStore.setState({ values: { 'integrations.claudeHooks': false } })

    // An unrelated row changing is not a change to this one.
    expect(seen).toEqual([undefined, true, false])

    await h.dispose()
    settingsStore.setState({ values: { 'integrations.claudeHooks': true } })
    expect(seen).toEqual([undefined, true, false])
  })
})
