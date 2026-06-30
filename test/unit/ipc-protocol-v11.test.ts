import { describe, expect, test } from 'bun:test'

import {
  IPC_CAPABILITY_CREATE_TAB_SIZE_FALLBACK,
  IPC_CAPABILITY_HOT_REEXEC,
  IPC_CAPABILITY_LIST_TABS,
  IPC_CAPABILITY_THIN_ATTACH,
  IPC_PROTOCOL_CAPABILITIES,
  IPC_PROTOCOL_MIN_VERSION,
  IPC_PROTOCOL_VERSION,
  parseClientRequest,
  parseServerMessage,
} from '../../src/ipc/protocol'

describe('ipc protocol v11', () => {
  test('MAX is 11, MIN stays at 10 (additive bump)', () => {
    expect(IPC_PROTOCOL_VERSION).toBe(11)
    expect(IPC_PROTOCOL_MIN_VERSION).toBe(10)
  })

  test('advertises the four v11 capabilities', () => {
    expect(IPC_PROTOCOL_CAPABILITIES).toContain(IPC_CAPABILITY_HOT_REEXEC)
    expect(IPC_PROTOCOL_CAPABILITIES).toContain(IPC_CAPABILITY_LIST_TABS)
    expect(IPC_PROTOCOL_CAPABILITIES).toContain(IPC_CAPABILITY_THIN_ATTACH)
    expect(IPC_PROTOCOL_CAPABILITIES).toContain(IPC_CAPABILITY_CREATE_TAB_SIZE_FALLBACK)
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
})
