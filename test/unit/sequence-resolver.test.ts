import { describe, expect, test } from 'bun:test'

import type { KeyResult } from '../../src/input/modes/types'

import { SequenceResolver } from '../../src/input/keymap/sequence-resolver'
import { KeyTrie } from '../../src/input/keymap/trie'

const MOVE_RESULT: KeyResult = { actions: [{ delta: 1, type: 'move-active-tab' }], effects: [] }
const CLOSE_RESULT: KeyResult = { actions: [{ type: 'close-active-tab' }], effects: [] }
const EMPTY_RESULT: KeyResult = { actions: [], effects: [] }

function buildTrie(bindings: Record<string, KeyResult>): KeyTrie {
  const trie = new KeyTrie()
  for (const [keys, result] of Object.entries(bindings)) {
    trie.insert(keys.split(' '), { result })
  }
  return trie
}

describe('SequenceResolver', () => {
  test('single-chord binding resolves immediately', () => {
    const trie = buildTrie({ j: MOVE_RESULT })
    const resolver = new SequenceResolver(trie, { timeoutMs: 300 })

    const result = resolver.feed('j')
    expect(result.type).toBe('resolved')
    if (result.type === 'resolved') {
      expect(result.binding.result).toBe(MOVE_RESULT)
    }
  })

  test('unbound chord returns passthrough', () => {
    const trie = buildTrie({ j: MOVE_RESULT })
    const resolver = new SequenceResolver(trie, { timeoutMs: 300 })

    expect(resolver.feed('x').type).toBe('passthrough')
  })

  test('multi-chord sequence: pending then resolved', () => {
    const trie = buildTrie({ 'd d': CLOSE_RESULT })
    const resolver = new SequenceResolver(trie, { timeoutMs: 300 })

    expect(resolver.feed('d').type).toBe('pending')

    const result = resolver.feed('d')
    expect(result.type).toBe('resolved')
    if (result.type === 'resolved') {
      expect(result.binding.result).toBe(CLOSE_RESULT)
    }
  })

  test('multi-chord sequence: wrong second key resets and retries from root', () => {
    const trie = buildTrie({
      'd d': CLOSE_RESULT,
      'j': MOVE_RESULT,
    })
    const resolver = new SequenceResolver(trie, { timeoutMs: 300 })

    expect(resolver.feed('d').type).toBe('pending')

    // 'j' is not a valid continuation of 'd', so resolver resets and retries 'j' from root
    const result = resolver.feed('j')
    expect(result.type).toBe('resolved')
    if (result.type === 'resolved') {
      expect(result.binding.result).toBe(MOVE_RESULT)
    }
  })

  test('multi-chord sequence: wrong key that is also unbound returns passthrough', () => {
    const trie = buildTrie({ 'd d': CLOSE_RESULT })
    const resolver = new SequenceResolver(trie, { timeoutMs: 300 })

    expect(resolver.feed('d').type).toBe('pending')
    expect(resolver.feed('x').type).toBe('passthrough')
  })

  test('exact+prefix: returns pending, resolves on timeout', async () => {
    const trie = new KeyTrie()
    trie.insert(['d'], { result: EMPTY_RESULT })
    trie.insert(['d', 'd'], { result: CLOSE_RESULT })

    const resolver = new SequenceResolver(trie, { timeoutMs: 50 })

    let timeoutBinding: unknown = null
    resolver.setTimeoutCallback((b) => {
      timeoutBinding = b
    })

    expect(resolver.feed('d').type).toBe('pending')

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(timeoutBinding).not.toBeNull()
    expect((timeoutBinding as { result: unknown }).result).toBe(EMPTY_RESULT)
  })

  test('exact+prefix: second key before timeout advances into children', () => {
    const trie = new KeyTrie()
    trie.insert(['d'], { result: EMPTY_RESULT })
    trie.insert(['d', 'd'], { result: CLOSE_RESULT })

    const resolver = new SequenceResolver(trie, { timeoutMs: 300 })

    let timeoutFired = false
    resolver.setTimeoutCallback(() => {
      timeoutFired = true
    })

    expect(resolver.feed('d').type).toBe('pending')
    const result = resolver.feed('d')
    expect(result.type).toBe('resolved')
    if (result.type === 'resolved') {
      expect(result.binding.result).toBe(CLOSE_RESULT)
    }
    expect(timeoutFired).toBe(false)
  })

  test('reset clears pending state', () => {
    const trie = buildTrie({ 'd d': CLOSE_RESULT })
    const resolver = new SequenceResolver(trie, { timeoutMs: 300 })

    resolver.feed('d')
    resolver.reset()

    // After reset, 'd' should start a new sequence
    expect(resolver.feed('d').type).toBe('pending')
  })

  test('reset clears timeout', async () => {
    const trie = new KeyTrie()
    trie.insert(['d'], { result: EMPTY_RESULT })
    trie.insert(['d', 'd'], { result: CLOSE_RESULT })

    const resolver = new SequenceResolver(trie, { timeoutMs: 50 })

    let timeoutFired = false
    resolver.setTimeoutCallback(() => {
      timeoutFired = true
    })

    resolver.feed('d')
    resolver.reset()

    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(timeoutFired).toBe(false)
  })

  test('three-key sequence resolves', () => {
    const trie = buildTrie({ 'g t n': MOVE_RESULT })
    const resolver = new SequenceResolver(trie, { timeoutMs: 300 })

    expect(resolver.feed('g').type).toBe('pending')
    expect(resolver.feed('t').type).toBe('pending')

    const result = resolver.feed('n')
    expect(result.type).toBe('resolved')
    if (result.type === 'resolved') {
      expect(result.binding.result).toBe(MOVE_RESULT)
    }
  })

  test('function binding resolves with the function itself', () => {
    const fn = () => MOVE_RESULT
    const trie = new KeyTrie()
    trie.insert(['j'], { result: fn })

    const resolver = new SequenceResolver(trie, { timeoutMs: 300 })
    const result = resolver.feed('j')
    expect(result.type).toBe('resolved')
    if (result.type === 'resolved') {
      expect(result.binding.result).toBe(fn)
    }
  })

  test('pending change callback fires when entering pending state', () => {
    const trie = buildTrie({ 'd d': CLOSE_RESULT })
    const resolver = new SequenceResolver(trie, { timeoutMs: 300 })

    const pendingStates: (string[] | null)[] = []
    resolver.setPendingChangeCallback((chords) => pendingStates.push(chords))

    resolver.feed('d')
    expect(pendingStates).toEqual([['d']])
  })

  test('pending change callback fires with null when sequence resolves', () => {
    const trie = buildTrie({ 'd d': CLOSE_RESULT })
    const resolver = new SequenceResolver(trie, { timeoutMs: 300 })

    const pendingStates: (string[] | null)[] = []
    resolver.setPendingChangeCallback((chords) => pendingStates.push(chords))

    resolver.feed('d')
    resolver.feed('d')
    expect(pendingStates).toEqual([['d'], null])
  })

  test('pending change callback fires with null on reset', () => {
    const trie = buildTrie({ 'd d': CLOSE_RESULT })
    const resolver = new SequenceResolver(trie, { timeoutMs: 300 })

    const pendingStates: (string[] | null)[] = []
    resolver.setPendingChangeCallback((chords) => pendingStates.push(chords))

    resolver.feed('d')
    resolver.reset()
    expect(pendingStates).toEqual([['d'], null])
  })

  test('pending change callback accumulates chords for multi-key sequences', () => {
    const trie = buildTrie({ 'g t n': MOVE_RESULT })
    const resolver = new SequenceResolver(trie, { timeoutMs: 300 })

    const pendingStates: (string[] | null)[] = []
    resolver.setPendingChangeCallback((chords) => pendingStates.push(chords))

    resolver.feed('g')
    resolver.feed('t')
    expect(pendingStates).toEqual([['g'], ['g', 't']])
  })

  test('pending change callback not called when chord resolves immediately', () => {
    const trie = buildTrie({ j: MOVE_RESULT })
    const resolver = new SequenceResolver(trie, { timeoutMs: 300 })

    const pendingStates: (string[] | null)[] = []
    resolver.setPendingChangeCallback((chords) => pendingStates.push(chords))

    resolver.feed('j')
    expect(pendingStates).toEqual([])
  })

  describe('repeatable bindings', () => {
    test('re-fires same binding on terminal key alone after resolve', () => {
      const trie = new KeyTrie()
      trie.insert(['C-w', 'J'], { repeatable: true, result: MOVE_RESULT })
      const resolver = new SequenceResolver(trie, { timeoutMs: 300 })

      expect(resolver.feed('C-w').type).toBe('pending')
      const first = resolver.feed('J')
      expect(first.type).toBe('resolved')

      const repeat1 = resolver.feed('J')
      expect(repeat1.type).toBe('resolved')
      if (repeat1.type === 'resolved') {
        expect(repeat1.binding.result).toBe(MOVE_RESULT)
      }

      const repeat2 = resolver.feed('J')
      expect(repeat2.type).toBe('resolved')
    })

    test('non-matching key breaks the repeat streak', () => {
      const trie = new KeyTrie()
      trie.insert(['C-w', 'J'], { repeatable: true, result: MOVE_RESULT })
      trie.insert(['K'], { result: CLOSE_RESULT })
      const resolver = new SequenceResolver(trie, { timeoutMs: 300 })

      resolver.feed('C-w')
      resolver.feed('J')

      const other = resolver.feed('K')
      expect(other.type).toBe('resolved')
      if (other.type === 'resolved') {
        expect(other.binding.result).toBe(CLOSE_RESULT)
      }

      // 'J' should no longer repeat — it falls through to passthrough
      expect(resolver.feed('J').type).toBe('passthrough')
    })

    test('non-repeatable binding does not set repeat state', () => {
      const trie = new KeyTrie()
      trie.insert(['C-w', 'J'], { result: MOVE_RESULT })
      const resolver = new SequenceResolver(trie, { timeoutMs: 300 })

      resolver.feed('C-w')
      resolver.feed('J')

      expect(resolver.feed('J').type).toBe('passthrough')
    })

    test('starting a new prefix clears the repeat streak', () => {
      const trie = new KeyTrie()
      trie.insert(['C-w', 'J'], { repeatable: true, result: MOVE_RESULT })
      trie.insert(['C-w', 'H'], { result: CLOSE_RESULT })
      const resolver = new SequenceResolver(trie, { timeoutMs: 300 })

      resolver.feed('C-w')
      resolver.feed('J')

      // New chord on <C-w>: prefix branch clears repeat state
      expect(resolver.feed('C-w').type).toBe('pending')
      const resolved = resolver.feed('H')
      expect(resolved.type).toBe('resolved')
      if (resolved.type === 'resolved') {
        expect(resolved.binding.result).toBe(CLOSE_RESULT)
      }

      // 'J' alone no longer repeats
      expect(resolver.feed('J').type).toBe('passthrough')
    })

    test('reset() clears repeat state', () => {
      const trie = new KeyTrie()
      trie.insert(['C-w', 'J'], { repeatable: true, result: MOVE_RESULT })
      const resolver = new SequenceResolver(trie, { timeoutMs: 300 })

      resolver.feed('C-w')
      resolver.feed('J')
      resolver.reset()

      expect(resolver.feed('J').type).toBe('passthrough')
    })

    test('timeout-fired exact+prefix binding sets repeat when repeatable', async () => {
      const trie = new KeyTrie()
      trie.insert(['J'], { repeatable: true, result: MOVE_RESULT })
      trie.insert(['J', 'X'], { result: CLOSE_RESULT })
      const resolver = new SequenceResolver(trie, { timeoutMs: 10 })

      const fired: KeyResult[] = []
      resolver.setTimeoutCallback((binding) => {
        fired.push(binding.result as KeyResult)
      })

      expect(resolver.feed('J').type).toBe('pending')
      await new Promise((r) => setTimeout(r, 25))
      expect(fired[0]).toBe(MOVE_RESULT)

      // Now 'J' alone should repeat
      expect(resolver.feed('J').type).toBe('resolved')
    })
  })
})
