import { describe, expect, test } from 'bun:test'

import {
  IPC_CAPABILITY_PROJECT_LIFECYCLE,
  IPC_CAPABILITY_TAB_TAIL,
  IPC_CAPABILITY_WORKTREE_LIFECYCLE_EVENTS,
  IPC_PROTOCOL_CAPABILITIES,
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
  test('MAX still includes the historical v12 feature level', () => {
    expect(IPC_PROTOCOL_VERSION).toBeGreaterThanOrEqual(12)
  })

  test('advertises every v12 capability', () => {
    expect(IPC_PROTOCOL_CAPABILITIES).toContain(IPC_CAPABILITY_PROJECT_LIFECYCLE)
    expect(IPC_PROTOCOL_CAPABILITIES).toContain(IPC_CAPABILITY_WORKTREE_LIFECYCLE_EVENTS)
    expect(IPC_PROTOCOL_CAPABILITIES).toContain(IPC_CAPABILITY_TAB_TAIL)
  })

  test('createProject round-trips with a name', () => {
    expect(() =>
      parseClientRequest({
        id: 'r1',
        payload: { name: 'my-ws', projectPath: '/tmp/foo', switch: true },
        type: 'createProject',
      })
    ).not.toThrow()
  })

  test('createProject rejects an empty name', () => {
    expect(() =>
      parseClientRequest({
        id: 'r1',
        payload: { name: '' },
        type: 'createProject',
      })
    ).toThrow('createProject.name must be a non-empty string')
  })

  test('switchProject round-trips with a targetProjectId', () => {
    expect(() =>
      parseClientRequest({
        id: 'r2',
        payload: { targetProjectId: 'project-2' },
        type: 'switchProject',
      })
    ).not.toThrow()
  })

  test('switchProject rejects a missing targetProjectId', () => {
    expect(() =>
      parseClientRequest({
        id: 'r2',
        payload: {},
        type: 'switchProject',
      })
    ).toThrow('switchProject.targetProjectId must be a string')
  })

  test('closeProject round-trips with targetProjectId', () => {
    expect(() =>
      parseClientRequest({
        id: 'r3',
        payload: { targetProjectId: 'project-3' },
        type: 'closeProject',
      })
    ).not.toThrow()
  })

  test('announceProjectSwitched round-trips', () => {
    expect(() =>
      parseClientRequest({
        id: 'r4',
        payload: { projectId: 'project-4' },
        type: 'announceProjectSwitched',
      })
    ).not.toThrow()
  })

  test('addWorktreeRecord requires a valid WorktreeRecord', () => {
    expect(() =>
      parseClientRequest({
        id: 'r5',
        payload: { projectId: 'project-5', worktree: WORKTREE_FIXTURE },
        type: 'addWorktreeRecord',
      })
    ).not.toThrow()
  })

  test('addWorktreeRecord rejects a malformed worktree', () => {
    expect(() =>
      parseClientRequest({
        id: 'r5',
        payload: { projectId: 'project-5', worktree: { id: 'wt-1' } },
        type: 'addWorktreeRecord',
      })
    ).toThrow('addWorktreeRecord.worktree must be a WorktreeRecord')
  })

  test('removeWorktreeRecord requires both ids', () => {
    expect(() =>
      parseClientRequest({
        id: 'r6',
        payload: { projectId: 'project-6', worktreeId: 'wt-1' },
        type: 'removeWorktreeRecord',
      })
    ).not.toThrow()
  })

  test('projectSwitchRequested event round-trips', () => {
    expect(() =>
      parseServerMessage({
        payload: { targetProjectId: 'project-1' },
        type: 'projectSwitchRequested',
      })
    ).not.toThrow()
  })

  test('projectCreateRequested event round-trips', () => {
    expect(() =>
      parseServerMessage({
        payload: { name: 'ws', projectPath: '/tmp/x', switch: false },
        type: 'projectCreateRequested',
      })
    ).not.toThrow()
  })

  test('projectCloseRequested event round-trips', () => {
    expect(() =>
      parseServerMessage({
        payload: { targetProjectId: 'project-1' },
        type: 'projectCloseRequested',
      })
    ).not.toThrow()
  })

  test('projectSwitched event round-trips', () => {
    expect(() =>
      parseServerMessage({
        payload: { projectId: 'project-1' },
        type: 'projectSwitched',
      })
    ).not.toThrow()
  })

  test('worktreeAdded event round-trips', () => {
    expect(() =>
      parseServerMessage({
        payload: { projectId: 'project-1', worktree: WORKTREE_FIXTURE },
        type: 'worktreeAdded',
      })
    ).not.toThrow()
  })

  test('worktreeAdded rejects a malformed worktree', () => {
    expect(() =>
      parseServerMessage({
        payload: { projectId: 'project-1', worktree: { id: 'wt-1' } },
        type: 'worktreeAdded',
      })
    ).toThrow('worktreeAdded.worktree must be a WorktreeRecord')
  })

  test('worktreeRemoved event round-trips', () => {
    expect(() =>
      parseServerMessage({
        payload: { projectId: 'project-1', worktreeId: 'wt-1' },
        type: 'worktreeRemoved',
      })
    ).not.toThrow()
  })
})
