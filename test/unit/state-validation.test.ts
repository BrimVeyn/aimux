import { describe, expect, test } from 'bun:test'

import { isSessionRecord, isSnippetRecord, isWorkspaceSnapshotV1 } from '../../src/state/validation'

describe('state validation', () => {
  test('accepts a valid workspace snapshot', () => {
    expect(
      isWorkspaceSnapshotV1({
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

  test('rejects malformed workspace snapshots', () => {
    expect(
      isWorkspaceSnapshotV1({
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

  test('rejects malformed session records', () => {
    expect(
      isSessionRecord({
        createdAt: new Date().toISOString(),
        id: 'session-1',
        lastOpenedAt: 123,
        name: 'Main workspace',
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
})
