import { describe, expect, mock, test } from 'bun:test'

import {
  createSessionFromCurrentState,
  deleteSessionRecords,
} from '../../src/app-runtime/session-actions'
import {
  deleteSnippetState,
  pasteSnippetToTab,
  saveSnippetEditorState,
} from '../../src/app-runtime/snippet-actions'
import { mergeConfigSnippets } from '../../src/state/snippet-catalog'
import { createInitialState } from '../../src/state/store'
import { createDefaultTerminalModes } from '../../src/state/terminal-modes'

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
        nameBuffer: '',
        selectedIndex: 0,
        sessionTargetId: null,
        triggerBuffer: '',
        type: 'snippet-editor' as const,
      },
      snippets: [],
    }

    const created = saveSnippetEditorState(createState)
    expect(created).toHaveLength(1)
    expect(created?.[0]?.name).toBe('Review')
    expect(created?.[0]?.trigger).toBeUndefined()

    const updateState = {
      ...createInitialState(),
      modal: {
        activeField: 'name' as const,
        contentBuffer: 'New content',
        editBuffer: 'New',
        nameBuffer: '',
        selectedIndex: 0,
        sessionTargetId: 'n1',
        triggerBuffer: 'rv',
        type: 'snippet-editor' as const,
      },
      snippets: [{ content: 'Old content', id: 'n1', name: 'Old' }],
    }

    const updated = saveSnippetEditorState(updateState)
    expect(updated).toEqual([{ content: 'New content', id: 'n1', name: 'New', trigger: 'rv' }])
  })

  test('pastes snippet content through the backend using tab paste mode', () => {
    const backend = {
      scrollViewportToBottom: mock(() => {}),
      write: mock(() => {}),
    }
    const activeTab = {
      assistant: 'terminal' as const,
      buffer: '',
      command: 'zsh',
      id: 'tab-1',
      status: 'running' as const,
      terminalModes: { ...createDefaultTerminalModes(), bracketedPasteMode: true },
      title: 'Terminal',
      viewport: {
        baseY: 5,
        cursorVisible: true,
        lines: [],
        viewportY: 1,
      },
    }

    pasteSnippetToTab(backend as never, 'tab-1', activeTab, {
      content: 'echo hello',
      id: 'snip-1',
      name: 'Example',
    })

    expect(backend.scrollViewportToBottom).toHaveBeenCalledWith('tab-1')
    expect(backend.write).toHaveBeenCalledWith('tab-1', '\x1b[200~echo hello\x1b[201~')
  })

  test('mergeConfigSnippets gives config snippets stable ids and wins on collision', () => {
    const user = [
      { content: 'mine', id: 'u1', name: 'mine' },
      { content: 'stale', id: 'config:gco', name: 'gco' },
    ]
    const cfg = [{ name: 'gco', text: 'git checkout', trigger: 'gco' }]

    const merged = mergeConfigSnippets(user, cfg)

    expect(merged).toEqual([
      { content: 'git checkout', id: 'config:gco', name: 'gco', trigger: 'gco' },
      { content: 'mine', id: 'u1', name: 'mine' },
    ])
  })

  test('saveSnippetEditorState refuses to write a config-pinned snippet', () => {
    const state = {
      ...createInitialState(),
      modal: {
        activeField: 'name' as const,
        contentBuffer: 'New content',
        editBuffer: 'gco',
        nameBuffer: '',
        selectedIndex: 0,
        sessionTargetId: 'config:gco',
        triggerBuffer: 'gco',
        type: 'snippet-editor' as const,
      },
      snippets: [{ content: 'git checkout', id: 'config:gco', name: 'gco' }],
    }
    expect(saveSnippetEditorState(state)).toBeNull()
  })

  test('deleteSnippetState refuses to remove a config-pinned snippet', () => {
    const snippets = [
      { content: 'user', id: 'u1', name: 'user' },
      { content: 'config', id: 'config:foo', name: 'foo' },
    ]
    expect(deleteSnippetState(snippets, 'config:foo')).toEqual(snippets)
    expect(deleteSnippetState(snippets, 'u1')).toEqual([
      { content: 'config', id: 'config:foo', name: 'foo' },
    ])
  })
})
