import { actions, resolveConfig } from '@brimveyn/aimux-config'
import { describe, expect, test } from 'bun:test'

import { KeymapBuilder } from '../../packages/aimux-config/src/keymap-builder'
import { describeBindings } from '../../src/input/keymap/describe-bindings'

describe('KeymapBuilder.mode with array of modes', () => {
  test('registers identical bindings under every mode in the array', () => {
    const kb = new KeymapBuilder()
    kb.mode(['navigation', 'terminal-input'], (m) => m.map('<C-s>', actions.helpModal, 'Help'))
    const built = kb._build()
    const nav = built.modes.get('navigation')
    const term = built.modes.get('terminal-input')
    expect(nav?.bindings.map((b) => b.keys)).toEqual(['<C-s>'])
    expect(term?.bindings.map((b) => b.keys)).toEqual(['<C-s>'])
  })

  test('single-string form still works', () => {
    const kb = new KeymapBuilder()
    kb.mode('navigation', (m) => m.map('X', actions.helpModal))
    const built = kb._build()
    expect(built.modes.get('navigation')?.bindings.map((b) => b.keys)).toEqual(['X'])
    expect(built.modes.get('terminal-input')).toBeUndefined()
  })

  test('empty array is a no-op (defines no modes)', () => {
    const kb = new KeymapBuilder()
    kb.mode([], (m) => m.map('X', actions.helpModal))
    const built = kb._build()
    expect(built.modes.size).toBe(0)
  })

  test('last write wins across overlapping mode calls', () => {
    const kb = new KeymapBuilder()
    kb.mode('navigation', (m) => m.map('Q', actions.helpModal, 'first'))
    kb.mode(['navigation', 'layout'], (m) => m.map('R', actions.helpModal, 'second'))
    const built = kb._build()
    expect(built.modes.get('navigation')?.bindings.map((b) => b.keys)).toEqual(['R'])
    expect(built.modes.get('layout')?.bindings.map((b) => b.keys)).toEqual(['R'])
  })
})

describe('resolveConfig with multi-mode bindings', () => {
  test('user bindings land in every listed mode and merge on top of defaults', () => {
    const resolved = resolveConfig({
      keymaps: (k) =>
        k.mode(['navigation', 'layout'], (m) => m.map('Y', actions.helpModal, 'My action')),
    })
    const nav = describeBindings(resolved.keymaps, 'navigation', { withDescriptionOnly: true })
    const layout = describeBindings(resolved.keymaps, 'layout', { withDescriptionOnly: true })
    expect(nav.find((b) => b.keys === 'Y' && b.description === 'My action')).toBeDefined()
    expect(layout.find((b) => b.keys === 'Y' && b.description === 'My action')).toBeDefined()
  })
})
