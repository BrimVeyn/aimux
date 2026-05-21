import { describe, expect, test } from 'bun:test'

import type { SnippetRecord } from '../../src/state/types'

import { createTriggerDetector } from '../../src/snippets/trigger-detector'

function makeDetector(opts: {
  snippets: SnippetRecord[]
  triggerChar?: string
  now?: () => number
}) {
  return createTriggerDetector({
    getSnippets: () => opts.snippets,
    getTriggerChar: () => opts.triggerChar ?? ':',
    now: opts.now,
  })
}

function feedString(detector: ReturnType<typeof makeDetector>, input: string) {
  let lastMatch: ReturnType<typeof detector.feed> = null
  for (const ch of input) {
    lastMatch = detector.feed(ch)
  }
  return lastMatch
}

const sigSnippet: SnippetRecord = {
  content: 'Best, Nathan',
  id: 's1',
  name: 'Signature',
  trigger: 'sig',
}
const sSnippet: SnippetRecord = {
  content: 'small',
  id: 's2',
  name: 'S',
  trigger: 's',
}

describe('trigger detector', () => {
  test('matches a complete trigger on space', () => {
    let t = 0
    const detector = makeDetector({
      now: () => (t += 100),
      snippets: [sigSnippet],
    })
    const match = feedString(detector, ':sig ')
    expect(match).not.toBeNull()
    expect(match?.snippet.id).toBe('s1')
    expect(match?.triggerText).toBe(':sig ')
  })

  test('matches with custom trigger char', () => {
    let t = 0
    const detector = makeDetector({
      now: () => (t += 100),
      snippets: [sigSnippet],
      triggerChar: ';',
    })
    const match = feedString(detector, ';sig\t')
    expect(match?.triggerText).toBe(';sig\t')
  })

  test('does not match unknown buffer', () => {
    let t = 0
    const detector = makeDetector({
      now: () => (t += 100),
      snippets: [sigSnippet],
    })
    const match = feedString(detector, ':nope ')
    expect(match).toBeNull()
  })

  test('two triggers share a prefix and both work on separator', () => {
    let t = 0
    const detector = makeDetector({
      now: () => (t += 100),
      snippets: [sSnippet, sigSnippet],
    })
    expect(feedString(detector, ':s ')?.snippet.id).toBe('s2')
    expect(feedString(detector, ':sig ')?.snippet.id).toBe('s1')
  })

  test('overflows after 32 chars and resets', () => {
    let t = 0
    const detector = makeDetector({
      now: () => (t += 100),
      snippets: [sigSnippet],
    })
    detector.feed(':')
    for (let i = 0; i < 40; i++) detector.feed('a')
    const match = detector.feed(' ')
    expect(match).toBeNull()
  })

  test('rapid feeds (< 5ms) reset detection (paste heuristic)', () => {
    let t = 0
    const detector = makeDetector({
      now: () => t,
      snippets: [sigSnippet],
    })
    t = 0
    detector.feed(':')
    t = 1
    detector.feed('s')
    t = 2
    detector.feed('i')
    t = 3
    detector.feed('g')
    t = 4
    const match = detector.feed(' ')
    expect(match).toBeNull()
  })

  test('explicit reset clears state', () => {
    let t = 0
    const detector = makeDetector({
      now: () => (t += 100),
      snippets: [sigSnippet],
    })
    detector.feed(':')
    detector.feed('s')
    detector.reset()
    detector.feed('i')
    detector.feed('g')
    const match = detector.feed(' ')
    expect(match).toBeNull()
  })

  test('non-printable char during capture resets', () => {
    let t = 0
    const detector = makeDetector({
      now: () => (t += 100),
      snippets: [sigSnippet],
    })
    detector.feed(':')
    detector.feed('s')
    detector.feed('\x1b') // escape, non-printable
    detector.feed('i')
    detector.feed('g')
    const match = detector.feed(' ')
    expect(match).toBeNull()
  })

  test('typing a fresh trigger char restarts capture', () => {
    let t = 0
    const detector = makeDetector({
      now: () => (t += 100),
      snippets: [sigSnippet],
    })
    detector.feed(':')
    detector.feed('x')
    // restart with another `:`
    detector.feed(':')
    detector.feed('s')
    detector.feed('i')
    detector.feed('g')
    const match = detector.feed(' ')
    expect(match?.snippet.id).toBe('s1')
  })

  test('skips snippets without a trigger', () => {
    let t = 0
    const noTrigger: SnippetRecord = { content: 'x', id: 's3', name: 'Plain' }
    const detector = makeDetector({
      now: () => (t += 100),
      snippets: [noTrigger],
    })
    const match = feedString(detector, ':plain ')
    expect(match).toBeNull()
  })
})
