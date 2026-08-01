import { describe, expect, test } from 'bun:test'

import { isProjectRecord, isProjectSnapshotV1, isSnippetRecord } from '../../src/state/validation'

describe('state validation', () => {
  test('accepts a valid project snapshot', () => {
    expect(
      isProjectSnapshotV1({
        activeTabId: 'tab-1',
        savedAt: new Date().toISOString(),
        sidebar: { visible: true, width: 28 },
        tabs: [
          {
            assistant: 'claude',
            buffer: '',
            command: 'claude',
            id: 'tab-1',
            status: 'running',
            terminalModes: {
              alternateScrollMode: false,
              bracketedPasteMode: false,
              isAlternateBuffer: false,
              mouseTrackingMode: 'none',
              sendFocusMode: false,
            },
            title: 'Claude',
          },
        ],
        version: 1,
      })
    ).toBe(true)
  })

  test('rejects malformed project snapshots', () => {
    expect(
      isProjectSnapshotV1({
        activeTabId: 'tab-1',
        savedAt: new Date().toISOString(),
        sidebar: { visible: true, width: 28 },
        tabs: [
          {
            assistant: 'claude',
            buffer: '',
            command: 'claude',
            id: 'tab-1',
            status: 'running',
            terminalModes: {
              alternateScrollMode: false,
              bracketedPasteMode: false,
              isAlternateBuffer: false,
              mouseTrackingMode: 'invalid',
              sendFocusMode: false,
            },
            title: 'Claude',
          },
        ],
        version: 1,
      })
    ).toBe(false)
  })

  test('rejects malformed project records', () => {
    expect(
      isProjectRecord({
        createdAt: new Date().toISOString(),
        id: 'project-1',
        lastOpenedAt: 123,
        name: 'Main project',
        updatedAt: new Date().toISOString(),
      })
    ).toBe(false)
  })

  test('rejects malformed snippet records', () => {
    expect(
      isSnippetRecord({
        content: 42,
        id: 'snippet-1',
        name: 'Review',
      })
    ).toBe(false)
  })

  test('accepts a snippet with a trigger', () => {
    expect(
      isSnippetRecord({
        content: 'Hello',
        id: 'snippet-1',
        name: 'Greeting',
        trigger: 'hi',
      })
    ).toBe(true)
  })

  test('accepts a snippet without a trigger', () => {
    expect(
      isSnippetRecord({
        content: 'Hello',
        id: 'snippet-1',
        name: 'Greeting',
      })
    ).toBe(true)
  })

  test('rejects a snippet with a non-string trigger', () => {
    expect(
      isSnippetRecord({
        content: 'Hello',
        id: 'snippet-1',
        name: 'Greeting',
        trigger: 42,
      })
    ).toBe(false)
  })

  test('accepts a snippet with valid vars (shell type)', () => {
    expect(
      isSnippetRecord({
        content: 'value={{x}}',
        id: 'snippet-1',
        name: 'Has vars',
        vars: { x: { sh: 'echo hi', timeout: 1000, trim: true } },
      })
    ).toBe(true)
  })

  test('accepts a snippet with an empty vars object', () => {
    expect(
      isSnippetRecord({
        content: 'hi',
        id: 'snippet-1',
        name: 'Empty vars',
        vars: {},
      })
    ).toBe(true)
  })

  test('rejects a snippet whose var lacks a sh field', () => {
    expect(
      isSnippetRecord({
        content: 'hi',
        id: 'snippet-1',
        name: 'No sh',
        vars: { x: { timeout: 1000 } },
      })
    ).toBe(false)
  })

  test('rejects a snippet whose var has a non-string sh', () => {
    expect(
      isSnippetRecord({
        content: 'hi',
        id: 'snippet-1',
        name: 'Bad sh',
        vars: { x: { sh: 42 } },
      })
    ).toBe(false)
  })

  test('rejects a snippet whose var has a non-numeric timeout', () => {
    expect(
      isSnippetRecord({
        content: 'hi',
        id: 'snippet-1',
        name: 'Bad timeout',
        vars: { x: { sh: 'echo', timeout: 'soon' } },
      })
    ).toBe(false)
  })

  test('rejects a snippet whose var has a non-boolean trim', () => {
    expect(
      isSnippetRecord({
        content: 'hi',
        id: 'snippet-1',
        name: 'Bad trim',
        vars: { x: { sh: 'echo', trim: 'yes' } },
      })
    ).toBe(false)
  })

  test('rejects a snippet whose vars is not an object', () => {
    expect(
      isSnippetRecord({
        content: 'hi',
        id: 'snippet-1',
        name: 'Bad vars',
        vars: 'not-an-object',
      })
    ).toBe(false)
  })
})
