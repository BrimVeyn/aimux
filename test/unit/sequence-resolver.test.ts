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
})
