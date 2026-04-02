import { describe, expect, test } from 'bun:test'

import {
  createSessionFromCurrentState,
  deleteSessionRecords,
} from '../../src/app-runtime/session-actions'
import { deleteSnippetState, saveSnippetEditorState } from '../../src/app-runtime/snippet-actions'
import { createInitialState } from '../../src/state/store'

describe('session and snippet actions', () => {
  test('creates a new session from current state', () => {
    const state = {
      ...createInitialState(),
      tabs: [
        {
          id: 'tab-1',
          assistant: 'claude' as const,
          title: 'Claude',
          status: 'running' as const,
          activity: 'idle' as const,
          buffer: 'hello',
          terminalModes: {
            mouseTrackingMode: 'none' as const,
            sendFocusMode: false,
            alternateScrollMode: false,
            isAlternateBuffer: false,
            bracketedPasteMode: false,
          },
          command: 'claude',
        },
      ],
    }

    const result = createSessionFromCurrentState(state, 'Workspace A', '/tmp/workspace-a')

    expect(result.session.name).toBe('Workspace A')
    expect(result.sessions).toHaveLength(1)
    expect(result.session.workspaceSnapshot?.tabs).toHaveLength(1)
  })

  test('deletes sessions and snippets immutably', () => {
    expect(
      deleteSessionRecords(
        [
          {
            id: 's1',
            name: 'one',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
            lastOpenedAt: '2024-01-01T00:00:00.000Z',
          },
          {
            id: 's2',
            name: 'two',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
            lastOpenedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
        's1'
      )
    ).toHaveLength(1)

    expect(
      deleteSnippetState(
        [
          { id: 'n1', name: 'Review', content: 'A' },
          { id: 'n2', name: 'Explain', content: 'B' },
        ],
        'n1'
      )
    ).toEqual([{ id: 'n2', name: 'Explain', content: 'B' }])
  })

  test('saves snippet editor state for create and update', () => {
    const createState = {
      ...createInitialState(),
      snippets: [],
      modal: {
        type: 'snippet-editor' as const,
        selectedIndex: 0,
        editBuffer: 'Review',
        sessionTargetId: null,
        activeField: 'name' as const,
        contentBuffer: 'Check for bugs',
      },
    }

    const created = saveSnippetEditorState(createState)
    expect(created).toHaveLength(1)
    expect(created?.[0]?.name).toBe('Review')

    const updateState = {
      ...createInitialState(),
      snippets: [{ id: 'n1', name: 'Old', content: 'Old content' }],
      modal: {
        type: 'snippet-editor' as const,
        selectedIndex: 0,
        editBuffer: 'New',
        sessionTargetId: 'n1',
        activeField: 'name' as const,
        contentBuffer: 'New content',
      },
    }

    const updated = saveSnippetEditorState(updateState)
    expect(updated).toEqual([{ id: 'n1', name: 'New', content: 'New content' }])
  })
})
