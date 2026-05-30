import { describe, expect, test } from 'bun:test'

import { parseClientMessage } from '../../src/gui/protocol'

describe('parseClientMessage intent envelope', () => {
  test('accepts modal.setField with a known field id', () => {
    const raw = JSON.stringify({
      intent: { field: 'title', kind: 'modal.setField', value: 'wip: foo' },
      t: 'intent',
    })
    expect(parseClientMessage(raw)).toEqual({
      intent: { field: 'title', kind: 'modal.setField', value: 'wip: foo' },
      t: 'intent',
    })
  })

  test('rejects modal.setField with an unknown field id', () => {
    const raw = JSON.stringify({
      intent: { field: 'not-a-field', kind: 'modal.setField', value: 'x' },
      t: 'intent',
    })
    expect(parseClientMessage(raw)).toBeNull()
  })

  test('rejects modal.setField when value is not a string', () => {
    const raw = JSON.stringify({
      intent: { field: 'title', kind: 'modal.setField', value: 42 },
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
