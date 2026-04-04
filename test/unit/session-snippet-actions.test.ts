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
          activity: 'idle' as const,
          assistant: 'claude' as const,
          buffer: 'hello',
          command: 'claude',
          id: 'tab-1',
          status: 'running' as const,
          terminalModes: {
            alternateScrollMode: false,
            bracketedPasteMode: false,
            isAlternateBuffer: false,
            mouseTrackingMode: 'none' as const,
            sendFocusMode: false,
          },
          title: 'Claude',
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
            createdAt: '2024-01-01T00:00:00.000Z',
            id: 's1',
            lastOpenedAt: '2024-01-01T00:00:00.000Z',
            name: 'one',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          {
            createdAt: '2024-01-01T00:00:00.000Z',
            id: 's2',
            lastOpenedAt: '2024-01-01T00:00:00.000Z',
            name: 'two',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
        's1'
      )
    ).toHaveLength(1)

    expect(
      deleteSnippetState(
        [
          { content: 'A', id: 'n1', name: 'Review' },
          { content: 'B', id: 'n2', name: 'Explain' },
        ],
        'n1'
      )
    ).toEqual([{ content: 'B', id: 'n2', name: 'Explain' }])
  })

  test('saves snippet editor state for create and update', () => {
    const createState = {
      ...createInitialState(),
      modal: {
        activeField: 'name' as const,
        contentBuffer: 'Check for bugs',
        editBuffer: 'Review',
        selectedIndex: 0,
        sessionTargetId: null,
        type: 'snippet-editor' as const,
      },
      snippets: [],
    }

    const created = saveSnippetEditorState(createState)
    expect(created).toHaveLength(1)
    expect(created?.[0]?.name).toBe('Review')

    const updateState = {
      ...createInitialState(),
      modal: {
        activeField: 'name' as const,
        contentBuffer: 'New content',
        editBuffer: 'New',
        selectedIndex: 0,
        sessionTargetId: 'n1',
        type: 'snippet-editor' as const,
      },
      snippets: [{ content: 'Old content', id: 'n1', name: 'Old' }],
    }

    const updated = saveSnippetEditorState(updateState)
    expect(updated).toEqual([{ content: 'New content', id: 'n1', name: 'New' }])
  })
})
