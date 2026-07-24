import { describe, expect, test } from 'bun:test'

import {
  IPC_CAPABILITY_CREATE_TAB_SIZE_FALLBACK,
  IPC_CAPABILITY_CREATE_TAB_WORKTREE_ID,
  IPC_CAPABILITY_HOT_REEXEC,
  IPC_CAPABILITY_LIST_TABS,
  IPC_CAPABILITY_TAB_LIFECYCLE_EVENTS,
  IPC_CAPABILITY_THIN_ATTACH,
  IPC_PROTOCOL_CAPABILITIES,
  IPC_PROTOCOL_VERSION,
  parseClientRequest,
  parseServerMessage,
} from '../../src/ipc/protocol'

describe('ipc protocol v11', () => {
  test('MAX still includes the historical v11 feature level', () => {
    expect(IPC_PROTOCOL_VERSION).toBeGreaterThanOrEqual(11)
  })

  test('advertises every v11 capability', () => {
    expect(IPC_PROTOCOL_CAPABILITIES).toContain(IPC_CAPABILITY_HOT_REEXEC)
    expect(IPC_PROTOCOL_CAPABILITIES).toContain(IPC_CAPABILITY_LIST_TABS)
    expect(IPC_PROTOCOL_CAPABILITIES).toContain(IPC_CAPABILITY_THIN_ATTACH)
    expect(IPC_PROTOCOL_CAPABILITIES).toContain(IPC_CAPABILITY_CREATE_TAB_SIZE_FALLBACK)
    expect(IPC_PROTOCOL_CAPABILITIES).toContain(IPC_CAPABILITY_TAB_LIFECYCLE_EVENTS)
    expect(IPC_PROTOCOL_CAPABILITIES).toContain(IPC_CAPABILITY_CREATE_TAB_WORKTREE_ID)
  })

  test('listTabs round-trips with a string sessionId', () => {
    expect(() =>
      parseClientRequest({
        id: 'r1',
        payload: { sessionId: 'session-1' },
        type: 'listTabs',
      })
    ).not.toThrow()
  })

  test('listTabs rejects a non-string sessionId', () => {
    expect(() =>
      parseClientRequest({
        id: 'r1',
        payload: { sessionId: 42 },
        type: 'listTabs',
      })
    ).toThrow('listTabs.sessionId must be a string')
  })

  test('attach.thin parses as a boolean when present', () => {
    expect(() =>
      parseClientRequest({
        id: 'r2',
        payload: {
          cols: 80,
          protocolVersion: IPC_PROTOCOL_VERSION,
          rows: 24,
          sessionId: 'session-2',
          thin: true,
        },
        type: 'attach',
      })
    ).not.toThrow()
  })

  test('attach.thin rejects a non-boolean', () => {
    expect(() =>
      parseClientRequest({
        id: 'r3',
        payload: {
          cols: 80,
          protocolVersion: IPC_PROTOCOL_VERSION,
          rows: 24,
          sessionId: 'session-3',
          thin: 'yes',
        },
        type: 'attach',
      })
    ).toThrow('attach.thin must be a boolean when present')
  })

  test('listTabsResult round-trips with TabSessionSummary entries', () => {
    expect(() =>
      parseServerMessage({
        id: 'r4',
        payload: {
          activeTabId: 'tab-1',
          tabs: [
            {
              activity: 'idle',
              assistant: 'claude',
              command: 'claude',
              id: 'tab-1',
              status: 'running',
              title: 'Claude',
            },
          ],
        },
        type: 'listTabsResult',
      })
    ).not.toThrow()
  })

  test('listTabsResult rejects malformed entries', () => {
    expect(() =>
      parseServerMessage({
        id: 'r5',
        payload: {
          activeTabId: null,
          tabs: [{ id: 'tab-1' }],
        },
        type: 'listTabsResult',
      })
    ).toThrow('listTabsResult.payload is invalid')
  })

  test('createTab.worktreeId parses when present', () => {
    expect(() =>
      parseClientRequest({
        id: 'r6',
        payload: {
          assistant: 'claude',
          cols: 80,
          command: 'claude',
          rows: 24,
          tabId: 'tab-1',
          title: 'Claude',
          worktreeId: 'worktree-abc',
        },
        type: 'createTab',
      })
    ).not.toThrow()
  })

  test('createTab.worktreeId rejects a non-string value', () => {
    expect(() =>
      parseClientRequest({
        id: 'r7',
        payload: {
          assistant: 'claude',
          cols: 80,
          command: 'claude',
          rows: 24,
          tabId: 'tab-1',
          title: 'Claude',
          worktreeId: 12,
        },
        type: 'createTab',
      })
    ).toThrow('createTab.worktreeId must be a string when present')
  })

  test('workerName metadata round-trips on createTab and listTabsResult', () => {
    expect(
      parseClientRequest({
        id: 'req-worker',
        payload: {
          args: [],
          assistant: 'claude',
          cols: 120,
          command: 'claude',
          rows: 40,
          tabId: 'tab-worker',
          title: 'auth',
          workerName: 'auth',
        },
        type: 'createTab',
      })
    ).toMatchObject({ payload: { workerName: 'auth' } })

    expect(
      parseServerMessage({
        id: 'res-worker',
        payload: {
          activeTabId: 'tab-worker',
          tabs: [
            {
              assistant: 'claude',
              command: 'claude',
              id: 'tab-worker',
              status: 'running',
              title: 'auth',
              workerName: 'auth',
            },
          ],
        },
        type: 'listTabsResult',
      })
    ).toMatchObject({ payload: { tabs: [{ workerName: 'auth' }] } })
  })

  test('tabAdded event round-trips with a full TabSession', () => {
    expect(() =>
      parseServerMessage({
        payload: {
          sessionId: 'session-1',
          tab: {
            assistant: 'claude',
            buffer: '',
            command: 'claude',
            id: 'tab-1',
            status: 'starting',
            terminalModes: {
              alternateScrollMode: false,
              bracketedPasteMode: false,
              isAlternateBuffer: false,
              mouseTrackingMode: 'none',
              sendFocusMode: false,
            },
            title: 'Claude',
            worktreeId: 'wt-1',
          },
        },
        type: 'tabAdded',
      })
    ).not.toThrow()
  })

  test('tabAdded rejects a malformed tab payload', () => {
    expect(() =>
      parseServerMessage({
        payload: { sessionId: 'session-1', tab: { id: 'tab-1' } },
        type: 'tabAdded',
      })
    ).toThrow('tabAdded.tab is invalid')
  })
})
