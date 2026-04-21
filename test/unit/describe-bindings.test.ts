import { actions, getDefaultKeymapConfig, resolveConfig } from '@brimveyn/aimux-config'
import { describe, expect, test } from 'bun:test'

import { describeBindings, groupDescribedBindings } from '../../src/input/keymap/describe-bindings'

describe('describeBindings', () => {
  test('returns formatted keys and descriptions for a known mode', () => {
    const config = getDefaultKeymapConfig()
    const results = describeBindings(config, 'navigation', { withDescriptionOnly: true })
    const quit = results.find((r) => r.description === 'Quit')
    expect(quit).toBeDefined()
    expect(quit?.keysDisplay).toBe('Ctrl+C')
  })

  test('filters out bindings without descriptions when requested', () => {
    const config = getDefaultKeymapConfig()
    const withDesc = describeBindings(config, 'modal.theme-picker.filtering', {
      withDescriptionOnly: true,
    })
    const all = describeBindings(config, 'modal.theme-picker.filtering')
    expect(all.length).toBeGreaterThan(withDesc.length)
    expect(withDesc.every((b) => !!b.description)).toBe(true)
  })

  test('reflects user-config overrides', () => {
    const resolved = resolveConfig({
      keymaps: (k) => k.mode('navigation', (m) => m.map('Q', actions.quit, 'Quit it')),
    })
    const results = describeBindings(resolved.keymaps, 'navigation', {
      withDescriptionOnly: true,
    })
    const userQuit = results.find((r) => r.keys === 'Q' && r.description === 'Quit it')
    expect(userQuit).toBeDefined()
    expect(userQuit?.keysDisplay).toBe('Shift+Q')
  })

  test('merges alternative bindings by description preserving first-seen order', () => {
    const config = getDefaultKeymapConfig()
    const results = describeBindings(config, 'modal.theme-picker.filtering', {
      mergeAlternativesByDescription: true,
      withDescriptionOnly: true,
    })

    expect(results.map((r) => r.description)).toEqual([
      'Cancel',
      'Next',
      'Prev',
      'Confirm',
      'Toggle transparent',
    ])
    expect(results.find((r) => r.description === 'Next')?.keysDisplay).toBe('Ctrl+N / ↓')
    expect(results.find((r) => r.description === 'Prev')?.keysDisplay).toBe('Ctrl+P / ↑')
  })

  test('dedupes duplicate merged alternatives by displayed key', () => {
    const resolved = resolveConfig({
      keymaps: (k) =>
        k.mode('modal.theme-picker.filtering', (m) =>
          m
            .map('<Up>', actions.previewTheme(-1), 'Prev')
            .map('<Up>', actions.previewTheme(-1), 'Prev')
        ),
    })

    const results = describeBindings(resolved.keymaps, 'modal.theme-picker.filtering', {
      mergeAlternativesByDescription: true,
      withDescriptionOnly: true,
    })

    expect(results.find((r) => r.description === 'Prev')?.keysDisplay).toBe('Ctrl+P / ↑')
  })

  test('keeps legacy dedupe behavior when merge mode is disabled', () => {
    const config = getDefaultKeymapConfig()
    const results = describeBindings(config, 'modal.theme-picker.filtering', {
      dedupeByDescription: true,
      withDescriptionOnly: true,
    })

    expect(results.find((r) => r.description === 'Next')?.keysDisplay).toBe('Ctrl+N')
    expect(results.find((r) => r.description === 'Prev')?.keysDisplay).toBe('Ctrl+P')
  })

  test('reflects user-config-added alternatives in merged results', () => {
    const resolved = resolveConfig({
      keymaps: (k) =>
        k.mode('modal.theme-picker.filtering', (m) => m.map('k', actions.previewTheme(-1), 'Prev')),
    })

    const results = describeBindings(resolved.keymaps, 'modal.theme-picker.filtering', {
      mergeAlternativesByDescription: true,
      withDescriptionOnly: true,
    })

    expect(results.find((r) => r.description === 'Prev')?.keysDisplay).toBe('Ctrl+P / ↑ / k')
  })
})

describe('groupDescribedBindings', () => {
  test('groups bindings by their group label preserving insertion order', () => {
    const bindings = [
      { description: 'A', group: 'first', keys: 'a', keysDisplay: 'a' },
      { description: 'B', keys: 'b', keysDisplay: 'b' },
      { description: 'C', group: 'first', keys: 'c', keysDisplay: 'c' },
      { description: 'D', group: 'second', keys: 'd', keysDisplay: 'd' },
    ]
    const groups = groupDescribedBindings(bindings)
    expect(groups.map((g) => g.group)).toEqual(['first', undefined, 'second'])
    expect(groups[0]?.bindings.length).toBe(2)
  })
})
