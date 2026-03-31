import { describe, expect, test } from 'bun:test'

import { isSessionRecord, isSnippetRecord, isWorkspaceSnapshotV1 } from '../../src/state/validation'

describe('state validation', () => {
  test('accepts a valid workspace snapshot', () => {
    expect(
      isWorkspaceSnapshotV1({
        version: 1,
        savedAt: new Date().toISOString(),
        activeTabId: 'tab-1',
        sidebar: { visible: true, width: 28 },
        tabs: [
          {
            id: 'tab-1',
            assistant: 'claude',
            title: 'Claude',
            command: 'claude',
            status: 'running',
            buffer: '',
            terminalModes: {
              mouseTrackingMode: 'none',
              sendFocusMode: false,
              alternateScrollMode: false,
              isAlternateBuffer: false,
              bracketedPasteMode: false,
            },
          },
        ],
      })
    ).toBe(true)
  })

  test('rejects malformed workspace snapshots', () => {
    expect(
      isWorkspaceSnapshotV1({
        version: 1,
        savedAt: new Date().toISOString(),
        activeTabId: 'tab-1',
        sidebar: { visible: true, width: 28 },
        tabs: [
          {
            id: 'tab-1',
            assistant: 'claude',
            title: 'Claude',
            command: 'claude',
            status: 'running',
            buffer: '',
            terminalModes: {
              mouseTrackingMode: 'invalid',
              sendFocusMode: false,
              alternateScrollMode: false,
              isAlternateBuffer: false,
              bracketedPasteMode: false,
            },
          },
        ],
      })
    ).toBe(false)
  })

  test('rejects malformed session records', () => {
    expect(
      isSessionRecord({
        id: 'session-1',
        name: 'Main workspace',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastOpenedAt: 123,
      })
    ).toBe(false)
  })

  test('rejects malformed snippet records', () => {
    expect(
      isSnippetRecord({
        id: 'snippet-1',
        name: 'Review',
        content: 42,
      })
    ).toBe(false)
  })
})
