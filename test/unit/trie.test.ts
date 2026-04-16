import { describe, expect, test } from 'bun:test'

import type { KeyResult } from '../../src/input/modes/types'

import { KeyTrie } from '../../src/input/keymap/trie'

const EMPTY_RESULT: KeyResult = { actions: [], effects: [] }
const CLOSE_RESULT: KeyResult = { actions: [{ type: 'close-active-tab' }], effects: [] }
const MOVE_RESULT: KeyResult = { actions: [{ delta: 1, type: 'move-active-tab' }], effects: [] }

describe('KeyTrie', () => {
  test('insert and lookup single-chord binding', () => {
    const trie = new KeyTrie()
    trie.insert(['j'], { result: MOVE_RESULT })

    const match = trie.lookup('j')
    expect(match.type).toBe('exact')
    if (match.type === 'exact') {
      expect(match.binding.result).toBe(MOVE_RESULT)
    }
  })

  test('lookup returns none for unbound chord', () => {
    const trie = new KeyTrie()
    trie.insert(['j'], { result: MOVE_RESULT })

    expect(trie.lookup('k').type).toBe('none')
  })

  test('insert and lookup multi-chord binding', () => {
    const trie = new KeyTrie()
    trie.insert(['d', 'd'], { result: CLOSE_RESULT })

    const first = trie.lookup('d')
    expect(first.type).toBe('prefix')

    if (first.type === 'prefix') {
      const second = trie.lookup('d', first.node)
      expect(second.type).toBe('exact')
      if (second.type === 'exact') {
        expect(second.binding.result).toBe(CLOSE_RESULT)
      }
    }
  })

  test('exact+prefix when chord is both a binding and prefix', () => {
    const trie = new KeyTrie()
    trie.insert(['d'], { result: EMPTY_RESULT })
    trie.insert(['d', 'd'], { result: CLOSE_RESULT })

    const match = trie.lookup('d')
    expect(match.type).toBe('exact+prefix')
    if (match.type === 'exact+prefix') {
      expect(match.binding.result).toBe(EMPTY_RESULT)
      // Can continue into children
      const next = trie.lookup('d', match.node)
      expect(next.type).toBe('exact')
    }
  })

  test('overwrite existing binding', () => {
    const trie = new KeyTrie()
    trie.insert(['j'], { result: MOVE_RESULT })
    trie.insert(['j'], { result: CLOSE_RESULT })

    const match = trie.lookup('j')
    expect(match.type).toBe('exact')
    if (match.type === 'exact') {
      expect(match.binding.result).toBe(CLOSE_RESULT)
    }
  })

  test('remove single-chord binding', () => {
    const trie = new KeyTrie()
    trie.insert(['j'], { result: MOVE_RESULT })
    expect(trie.remove(['j'])).toBe(true)
    expect(trie.lookup('j').type).toBe('none')
  })

  test('remove multi-chord binding prunes empty branches', () => {
    const trie = new KeyTrie()
    trie.insert(['d', 'd'], { result: CLOSE_RESULT })
    expect(trie.remove(['d', 'd'])).toBe(true)
    expect(trie.lookup('d').type).toBe('none')
  })

  test('remove does not prune branches with other bindings', () => {
    const trie = new KeyTrie()
    trie.insert(['d', 'd'], { result: CLOSE_RESULT })
    trie.insert(['d', 'j'], { result: MOVE_RESULT })
    expect(trie.remove(['d', 'd'])).toBe(true)

    // 'd' should still be a prefix (for 'dj')
    const match = trie.lookup('d')
    expect(match.type).toBe('prefix')
  })

  test('remove returns false for non-existent sequence', () => {
    const trie = new KeyTrie()
    expect(trie.remove(['x'])).toBe(false)
  })

  test('remove returns false for prefix-only node (no binding)', () => {
    const trie = new KeyTrie()
    trie.insert(['d', 'd'], { result: CLOSE_RESULT })
    expect(trie.remove(['d'])).toBe(false)
  })

  test('group metadata preserved', () => {
    const trie = new KeyTrie()
    trie.insert(['space', 't', 'n'], { group: 'tabs', result: MOVE_RESULT })

    const first = trie.lookup('space')
    expect(first.type).toBe('prefix')
    if (first.type === 'prefix') {
      const second = trie.lookup('t', first.node)
      expect(second.type).toBe('prefix')
      if (second.type === 'prefix') {
        const third = trie.lookup('n', second.node)
        expect(third.type).toBe('exact')
        if (third.type === 'exact') {
          expect(third.binding.group).toBe('tabs')
        }
      }
    }
  })

  test('insert empty sequence is no-op', () => {
    const trie = new KeyTrie()
    trie.insert([], { result: MOVE_RESULT })
    expect(trie.root.children.size).toBe(0)
  })
})
