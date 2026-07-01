import { describe, expect, test } from 'bun:test'

import {
  IPC_CAPABILITY_TAB_TAIL,
  IPC_CAPABILITY_WORKSPACE_LIFECYCLE,
  IPC_CAPABILITY_WORKTREE_LIFECYCLE_EVENTS,
  IPC_PROTOCOL_CAPABILITIES,
  IPC_PROTOCOL_MIN_VERSION,
  IPC_PROTOCOL_VERSION,
  parseClientRequest,
  parseServerMessage,
} from '../../src/ipc/protocol'

const WORKTREE_FIXTURE = {
  createdAt: '2026-07-01T00:00:00.000Z',
  createdByAimux: true,
  id: 'wt-1',
  name: 'feat/x',
  path: '/tmp/wt/feat-x',
  repoRoot: '/tmp/repo',
  source: 'aimux-temp' as const,
  updatedAt: '2026-07-01T00:00:00.000Z',
}

describe('ipc protocol v12', () => {
  test('MAX is at least 12, MIN stays at 10 (additive bump)', () => {
    expect(IPC_PROTOCOL_VERSION).toBeGreaterThanOrEqual(12)
    expect(IPC_PROTOCOL_MIN_VERSION).toBe(10)
  })

  test('advertises every v12 capability', () => {
    expect(IPC_PROTOCOL_CAPABILITIES).toContain(IPC_CAPABILITY_WORKSPACE_LIFECYCLE)
    expect(IPC_PROTOCOL_CAPABILITIES).toContain(IPC_CAPABILITY_WORKTREE_LIFECYCLE_EVENTS)
    expect(IPC_PROTOCOL_CAPABILITIES).toContain(IPC_CAPABILITY_TAB_TAIL)
  })

  test('createWorkspace round-trips with a name', () => {
    expect(() =>
      parseClientRequest({
        id: 'r1',
        payload: { name: 'my-ws', projectPath: '/tmp/foo', switch: true },
        type: 'createWorkspace',
      })
    ).not.toThrow()
  })

  test('createWorkspace rejects an empty name', () => {
    expect(() =>
      parseClientRequest({
        id: 'r1',
        payload: { name: '' },
        type: 'createWorkspace',
      })
    ).toThrow('createWorkspace.name must be a non-empty string')
  })

  test('switchWorkspace round-trips with a targetSessionId', () => {
    expect(() =>
      parseClientRequest({
        id: 'r2',
        payload: { targetSessionId: 'session-2' },
        type: 'switchWorkspace',
      })
    ).not.toThrow()
  })

  test('switchWorkspace rejects a missing targetSessionId', () => {
    expect(() =>
      parseClientRequest({
        id: 'r2',
        payload: {},
        type: 'switchWorkspace',
      })
    ).toThrow('switchWorkspace.targetSessionId must be a string')
  })

  test('closeWorkspace parses force flag', () => {
    expect(() =>
      parseClientRequest({
        id: 'r3',
        payload: { force: true, targetSessionId: 'session-3' },
        type: 'closeWorkspace',
      })
    ).not.toThrow()
  })

  test('announceWorkspaceSwitched round-trips', () => {
    expect(() =>
      parseClientRequest({
        id: 'r4',
        payload: { sessionId: 'session-4' },
        type: 'announceWorkspaceSwitched',
      })
    ).not.toThrow()
  })

  test('addWorktreeRecord requires a valid WorktreeRecord', () => {
    expect(() =>
      parseClientRequest({
        id: 'r5',
        payload: { sessionId: 'session-5', worktree: WORKTREE_FIXTURE },
        type: 'addWorktreeRecord',
      })
    ).not.toThrow()
  })

  test('addWorktreeRecord rejects a malformed worktree', () => {
    expect(() =>
      parseClientRequest({
        id: 'r5',
        payload: { sessionId: 'session-5', worktree: { id: 'wt-1' } },
        type: 'addWorktreeRecord',
      })
    ).toThrow('addWorktreeRecord.worktree must be a WorktreeRecord')
  })

  test('removeWorktreeRecord requires both ids', () => {
    expect(() =>
      parseClientRequest({
        id: 'r6',
        payload: { sessionId: 'session-6', worktreeId: 'wt-1' },
        type: 'removeWorktreeRecord',
      })
    ).not.toThrow()
  })

  test('workspaceSwitchRequested event round-trips', () => {
    expect(() =>
      parseServerMessage({
        payload: { targetSessionId: 'session-1' },
        type: 'workspaceSwitchRequested',
      })
    ).not.toThrow()
  })

  test('workspaceCreateRequested event round-trips', () => {
    expect(() =>
      parseServerMessage({
        payload: { name: 'ws', projectPath: '/tmp/x', switch: false },
        type: 'workspaceCreateRequested',
      })
    ).not.toThrow()
  })

  test('workspaceCloseRequested event round-trips', () => {
    expect(() =>
      parseServerMessage({
        payload: { force: false, targetSessionId: 'session-1' },
        type: 'workspaceCloseRequested',
      })
    ).not.toThrow()
  })

  test('workspaceSwitched event round-trips', () => {
    expect(() =>
      parseServerMessage({
        payload: { sessionId: 'session-1' },
        type: 'workspaceSwitched',
      })
    ).not.toThrow()
  })

  test('worktreeAdded event round-trips', () => {
    expect(() =>
      parseServerMessage({
        payload: { sessionId: 'session-1', worktree: WORKTREE_FIXTURE },
        type: 'worktreeAdded',
      })
    ).not.toThrow()
  })

  test('worktreeAdded rejects a malformed worktree', () => {
    expect(() =>
      parseServerMessage({
        payload: { sessionId: 'session-1', worktree: { id: 'wt-1' } },
        type: 'worktreeAdded',
      })
    ).toThrow('worktreeAdded.worktree must be a WorktreeRecord')
  })

  test('worktreeRemoved event round-trips', () => {
    expect(() =>
      parseServerMessage({
        payload: { sessionId: 'session-1', worktreeId: 'wt-1' },
        type: 'worktreeRemoved',
      })
    ).not.toThrow()
  })
})
