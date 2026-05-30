import { describe, expect, test } from 'bun:test'

import { parseClientMessage } from '../../src/gui/protocol'

describe('parseClientMessage intent envelope', () => {
  test('accepts modal.snippet.submit with full payload + snippetId (edit)', () => {
    const raw = JSON.stringify({
      intent: {
        content: 'echo hi',
        kind: 'modal.snippet.submit',
        name: 'greet',
        snippetId: 'snip_123',
        trigger: 'gr',
      },
      t: 'intent',
    })
    expect(parseClientMessage(raw)).toEqual({
      intent: {
        content: 'echo hi',
        kind: 'modal.snippet.submit',
        name: 'greet',
        snippetId: 'snip_123',
        trigger: 'gr',
      },
      t: 'intent',
    })
  })

  test('accepts modal.snippet.submit without snippetId (create)', () => {
    const raw = JSON.stringify({
      intent: {
        content: 'echo hi',
        kind: 'modal.snippet.submit',
        name: 'greet',
        trigger: '',
      },
      t: 'intent',
    })
    expect(parseClientMessage(raw)).toEqual({
      intent: {
        content: 'echo hi',
        kind: 'modal.snippet.submit',
        name: 'greet',
        trigger: '',
      },
      t: 'intent',
    })
  })

  test('rejects modal.snippet.submit with missing name', () => {
    const raw = JSON.stringify({
      intent: { content: 'x', kind: 'modal.snippet.submit', trigger: '' },
      t: 'intent',
    })
    expect(parseClientMessage(raw)).toBeNull()
  })

  test('rejects modal.snippet.submit with missing trigger', () => {
    const raw = JSON.stringify({
      intent: { content: 'x', kind: 'modal.snippet.submit', name: 'n' },
      t: 'intent',
    })
    expect(parseClientMessage(raw)).toBeNull()
  })

  test('rejects modal.snippet.submit with missing content', () => {
    const raw = JSON.stringify({
      intent: { kind: 'modal.snippet.submit', name: 'n', trigger: '' },
      t: 'intent',
    })
    expect(parseClientMessage(raw)).toBeNull()
  })

  test('rejects modal.snippet.submit with non-string name', () => {
    const raw = JSON.stringify({
      intent: { content: 'x', kind: 'modal.snippet.submit', name: 42, trigger: '' },
      t: 'intent',
    })
    expect(parseClientMessage(raw)).toBeNull()
  })

  test('rejects modal.snippet.submit with non-string snippetId', () => {
    const raw = JSON.stringify({
      intent: {
        content: 'x',
        kind: 'modal.snippet.submit',
        name: 'n',
        snippetId: 7,
        trigger: '',
      },
      t: 'intent',
    })
    expect(parseClientMessage(raw)).toBeNull()
  })

  test('accepts modal.submit (no payload)', () => {
    const raw = JSON.stringify({ intent: { kind: 'modal.submit' }, t: 'intent' })
    expect(parseClientMessage(raw)).toEqual({
      intent: { kind: 'modal.submit' },
      t: 'intent',
    })
  })

  test('accepts modal.cancel (no payload)', () => {
    const raw = JSON.stringify({ intent: { kind: 'modal.cancel' }, t: 'intent' })
    expect(parseClientMessage(raw)).toEqual({
      intent: { kind: 'modal.cancel' },
      t: 'intent',
    })
  })

  test('accepts git.stageFile with a path', () => {
    const raw = JSON.stringify({
      intent: { kind: 'git.stageFile', path: 'src/foo.ts' },
      t: 'intent',
    })
    expect(parseClientMessage(raw)).toEqual({
      intent: { kind: 'git.stageFile', path: 'src/foo.ts' },
      t: 'intent',
    })
  })

  test('rejects git.stageFile with missing path', () => {
    const raw = JSON.stringify({ intent: { kind: 'git.stageFile' }, t: 'intent' })
    expect(parseClientMessage(raw)).toBeNull()
  })

  test('rejects git.unstageFile with non-string path', () => {
    const raw = JSON.stringify({
      intent: { kind: 'git.unstageFile', path: 123 },
      t: 'intent',
    })
    expect(parseClientMessage(raw)).toBeNull()
  })

  test('accepts git.discardFile with a path', () => {
    const raw = JSON.stringify({
      intent: { kind: 'git.discardFile', path: 'README.md' },
      t: 'intent',
    })
    expect(parseClientMessage(raw)).toEqual({
      intent: { kind: 'git.discardFile', path: 'README.md' },
      t: 'intent',
    })
  })

  test('rejects intent with unknown kind', () => {
    const raw = JSON.stringify({
      intent: { kind: 'mystery.verb' },
      t: 'intent',
    })
    expect(parseClientMessage(raw)).toBeNull()
  })

  test('rejects intent envelope with missing intent object', () => {
    const raw = JSON.stringify({ t: 'intent' })
    expect(parseClientMessage(raw)).toBeNull()
  })
})
