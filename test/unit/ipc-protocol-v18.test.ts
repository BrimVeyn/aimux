import { describe, expect, test } from 'bun:test'

import { IPC_PROTOCOL_VERSION, parseServerMessage } from '../../src/ipc/protocol'

describe('ipc protocol v18 workspaceId on status broadcasts', () => {
  test('MAX includes the v18 feature level', () => {
    expect(IPC_PROTOCOL_VERSION).toBeGreaterThanOrEqual(18)
  })

  test('tabStatus carries the workspace when the daemon knows one', () => {
    const parsed = parseServerMessage({
      payload: { projectId: 'p1', status: 'waiting-input', tabId: 't1', workspaceId: 'w1' },
      type: 'tabStatus',
    })
    expect(parsed).toMatchObject({ payload: { workspaceId: 'w1' } })
  })

  test('tabStatus without a workspace still parses — a v17 daemon sends none', () => {
    expect(() =>
      parseServerMessage({
        payload: { projectId: 'p1', status: 'idle', tabId: 't1' },
        type: 'tabStatus',
      })
    ).not.toThrow()
  })

  test('a non-string workspaceId is rejected on both status events', () => {
    expect(() =>
      parseServerMessage({
        payload: { projectId: 'p1', status: 'idle', tabId: 't1', workspaceId: 7 },
        type: 'tabStatus',
      })
    ).toThrow()
    expect(() =>
      parseServerMessage({
        payload: { idleMs: 1500, projectId: 'p1', tabId: 't1', workspaceId: 7 },
        type: 'tabTurnComplete',
      })
    ).toThrow()
  })

  test('tabTurnComplete carries the workspace', () => {
    const parsed = parseServerMessage({
      payload: { idleMs: 1500, projectId: 'p1', tabId: 't1', workspaceId: 'w1' },
      type: 'tabTurnComplete',
    })
    expect(parsed).toMatchObject({ payload: { workspaceId: 'w1' } })
  })
})
