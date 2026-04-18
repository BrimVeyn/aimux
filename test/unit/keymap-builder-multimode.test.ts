import { actions, resolveConfig } from '@brimveyn/aimux-config'
import { describe, expect, test } from 'bun:test'

import { KeymapBuilder } from '../../packages/aimux-config/src/keymap-builder'
import { describeBindings } from '../../src/input/keymap/describe-bindings'

describe('KeymapBuilder.mode with array of modes', () => {
  test('registers identical bindings under every mode in the array', () => {
    const kb = new KeymapBuilder()
    kb.mode(['navigation', 'terminal-input'], (m) => m.map('<C-s>', actions.helpModal(), 'Help'))
    const built = kb._build()
    const nav = built.modes.get('navigation')
    const term = built.modes.get('terminal-input')
    expect(nav?.bindings.map((b) => b.keys)).toEqual(['<C-s>'])
    expect(term?.bindings.map((b) => b.keys)).toEqual(['<C-s>'])
  })

  test('single-string form still works', () => {
    const kb = new KeymapBuilder()
    kb.mode('navigation', (m) => m.map('X', actions.helpModal()))
    const built = kb._build()
    expect(built.modes.get('navigation')?.bindings.map((b) => b.keys)).toEqual(['X'])
    expect(built.modes.get('terminal-input')).toBeUndefined()
  })

  test('empty array is a no-op (defines no modes)', () => {
    const kb = new KeymapBuilder()
    kb.mode([], (m) => m.map('X', actions.helpModal()))
    const built = kb._build()
    expect(built.modes.size).toBe(0)
  })

  test('repeated mode calls merge bindings; same-keys entries let the later one win', () => {
    const kb = new KeymapBuilder()
    kb.mode('navigation', (m) =>
      m.map('Q', actions.helpModal(), 'first').map('Z', actions.helpModal())
    )
    kb.mode(['navigation', 'git-mode'], (m) => m.map('Q', actions.helpModal(), 'override'))
    const built = kb._build()
    const nav = built.modes.get('navigation')
    expect(nav?.bindings.map((b) => b.keys).sort()).toEqual(['Q', 'Z'])
    const q = nav?.bindings.find((b) => b.keys === 'Q')
    expect(q?.description).toBe('override')
    expect(built.modes.get('git-mode')?.bindings.map((b) => b.keys)).toEqual(['Q'])
  })
})

describe('resolveConfig with multi-mode bindings', () => {
  test('user bindings land in every listed mode and merge on top of defaults', () => {
    const resolved = resolveConfig({
      keymaps: (k) =>
        k.mode(['navigation', 'git-mode'], (m) => m.map('Y', actions.helpModal(), 'My action')),
    })
    const nav = describeBindings(resolved.keymaps, 'navigation', { withDescriptionOnly: true })
    const git = describeBindings(resolved.keymaps, 'git-mode', { withDescriptionOnly: true })
    expect(nav.find((b) => b.keys === 'Y' && b.description === 'My action')).toBeDefined()
    expect(git.find((b) => b.keys === 'Y' && b.description === 'My action')).toBeDefined()
  })
})
