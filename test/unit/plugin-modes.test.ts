import { afterEach, describe, expect, test } from 'bun:test'

import type { AppState } from '../../src/state/types'

import {
  clearHelpModeLabels,
  helpModeLabels,
  registerHelpModeLabel,
} from '../../src/input/keymap/help-entries'
import {
  clearModeDerivations,
  deriveModeId,
  registerModeDerivation,
} from '../../src/input/modes/bridge'
import {
  clearPluginModes,
  isPluginModeId,
  isValidTransition,
  registeredPluginModes,
  registerPluginMode,
} from '../../src/input/modes/transitions'
import { createInitialState } from '../../src/state/store'

/**
 * `ModeId` is open to `plugin.*`, which means three tables that used to be
 * exhaustive no longer are: the transition matrix, the focus-mode derivation,
 * and the help overlay's headings. Each gets a registry, and each has to
 * behave when the plugin behind an id is gone.
 */

afterEach(() => {
  clearPluginModes()
  clearModeDerivations()
  clearHelpModeLabels()
})

describe('plugin mode transitions', () => {
  test('recognises the plugin namespace', () => {
    expect(isPluginModeId('plugin.acme.thing.review')).toBe(true)
    expect(isPluginModeId('navigation')).toBe(false)
    expect(isPluginModeId('modal.git-commit')).toBe(false)
  })

  test('built-in transitions are untouched', () => {
    expect(isValidTransition('navigation', 'git-mode')).toBe(true)
    expect(isValidTransition('navigation', 'modal.git-commit')).toBe(false)
  })

  test('a registered mode is reachable from navigation and returns to it', () => {
    registerPluginMode('plugin.acme.review')
    expect(isValidTransition('navigation', 'plugin.acme.review')).toBe(true)
    expect(isValidTransition('plugin.acme.review', 'navigation')).toBe(true)
  })

  test('a wider reach has to be declared', () => {
    registerPluginMode('plugin.acme.review', { from: ['git-mode'], to: ['git-mode'] })
    expect(isValidTransition('git-mode', 'plugin.acme.review')).toBe(true)
    expect(isValidTransition('plugin.acme.review', 'git-mode')).toBe(true)
    // Not declared, and not the navigation default.
    expect(isValidTransition('settings', 'plugin.acme.review')).toBe(false)
    expect(isValidTransition('plugin.acme.review', 'settings')).toBe(false)
  })

  test('an unregistered plugin mode is not a valid destination', () => {
    // Its plugin failed to load, or was unloaded while its mode was current.
    // Allowing the transition would strand input in a mode with no handler.
    expect(isValidTransition('navigation', 'plugin.acme.gone')).toBe(false)
    // The way out, on the other hand, always works.
    expect(isValidTransition('plugin.acme.gone', 'navigation')).toBe(true)
  })

  test('disposing makes the mode unreachable again', () => {
    const dispose = registerPluginMode('plugin.acme.review')
    expect(registeredPluginModes()).toEqual(['plugin.acme.review'])
    dispose()
    expect(registeredPluginModes()).toEqual([])
    expect(isValidTransition('navigation', 'plugin.acme.review')).toBe(false)
  })
})

describe('mode derivation', () => {
  const navigating = (): AppState => createInitialState()

  test('the built-in rules still apply with no derivation registered', () => {
    expect(deriveModeId(navigating())).toBe('navigation')
  })

  test('a derivation claims input before the built-in rules', () => {
    registerModeDerivation(() => 'plugin.acme.review')
    expect(deriveModeId(navigating())).toBe('plugin.acme.review')
  })

  test('returning null defers to the next derivation, then to the built-ins', () => {
    const seen: string[] = []
    registerModeDerivation(() => {
      seen.push('first')
      return null
    })
    registerModeDerivation(() => {
      seen.push('second')
      return null
    })
    expect(deriveModeId(navigating())).toBe('navigation')
    expect(seen).toEqual(['first', 'second'])
  })

  test('a derivation that unregisters itself mid-pass does not skip its neighbour', () => {
    const seen: string[] = []
    const dispose = registerModeDerivation(() => {
      seen.push('first')
      dispose()
      return null
    })
    registerModeDerivation(() => {
      seen.push('second')
      return null
    })
    deriveModeId(navigating())
    expect(seen).toEqual(['first', 'second'])
  })

  test('disposing gives the built-in rules back', () => {
    const dispose = registerModeDerivation(() => 'plugin.acme.review')
    expect(deriveModeId(navigating())).toBe('plugin.acme.review')
    dispose()
    expect(deriveModeId(navigating())).toBe('navigation')
  })
})

describe('help mode labels', () => {
  test('a plugin mode shows up in the help headings', () => {
    const before = helpModeLabels().length
    const dispose = registerHelpModeLabel('plugin.acme.review', 'Acme review')

    const labels = helpModeLabels()
    expect(labels).toHaveLength(before + 1)
    expect(labels.at(-1)).toEqual({ label: 'Acme review', modeId: 'plugin.acme.review' })

    // Without a heading a plugin's bindings resolve but are invisible: the
    // overlay iterates modes, so a missing mode reads as "no bindings".
    dispose()
    expect(helpModeLabels()).toHaveLength(before)
  })

  test('built-in headings come first and are never displaced', () => {
    registerHelpModeLabel('plugin.acme.review', 'Acme review')
    expect(helpModeLabels()[0]).toEqual({ label: 'Navigation', modeId: 'navigation' })
  })
})
