import { describe, expect, test } from 'bun:test'

import {
  IPC_CAPABILITY_LIST_TABS_LAST_LINE,
  IPC_CAPABILITY_QUESTION_EVENTS,
  IPC_CAPABILITY_TURN_LIFECYCLE,
  IPC_PROTOCOL_CAPABILITIES,
  IPC_PROTOCOL_MIN_VERSION,
  IPC_PROTOCOL_VERSION,
  parseServerMessage,
} from '../../src/ipc/protocol'

describe('ipc protocol v13', () => {
  test('MAX is at least 13, MIN stays at 10 (additive bump)', () => {
    expect(IPC_PROTOCOL_VERSION).toBeGreaterThanOrEqual(13)
    expect(IPC_PROTOCOL_MIN_VERSION).toBe(10)
  })

  test('advertises every v13 capability', () => {
    expect(IPC_PROTOCOL_CAPABILITIES).toContain(IPC_CAPABILITY_TURN_LIFECYCLE)
    expect(IPC_PROTOCOL_CAPABILITIES).toContain(IPC_CAPABILITY_QUESTION_EVENTS)
    expect(IPC_PROTOCOL_CAPABILITIES).toContain(IPC_CAPABILITY_LIST_TABS_LAST_LINE)
  })

  test('tabTurnComplete event round-trips', () => {
    const parsed = parseServerMessage({
      payload: { idleMs: 1500, sessionId: 'session-1', tabId: 'tab-1' },
      type: 'tabTurnComplete',
    })
    expect(parsed.type).toBe('tabTurnComplete')
  })

  test('tabTurnComplete rejects a non-numeric idleMs', () => {
    expect(() =>
      parseServerMessage({
        payload: { idleMs: 'soon', sessionId: 'session-1', tabId: 'tab-1' },
        type: 'tabTurnComplete',
      })
    ).toThrow('tabTurnComplete.idleMs must be a number')
  })

  test('tabQuestion event round-trips with options', () => {
    const parsed = parseServerMessage({
      payload: {
        kind: 'question',
        options: ['1. Yes', '2. No'],
        prompt: 'Do you want to proceed?',
        sessionId: 'session-1',
        tabId: 'tab-1',
      },
      type: 'tabQuestion',
    })
    expect(parsed.type).toBe('tabQuestion')
  })

  test('tabQuestion event round-trips without options', () => {
    expect(() =>
      parseServerMessage({
        payload: {
          kind: 'permission',
          prompt: 'Allow bash command?',
          sessionId: 'session-1',
          tabId: 'tab-1',
        },
        type: 'tabQuestion',
      })
    ).not.toThrow()
  })

  test('tabQuestion rejects an invalid kind', () => {
    expect(() =>
      parseServerMessage({
        payload: { kind: 'maybe', prompt: 'x', sessionId: 's', tabId: 't' },
        type: 'tabQuestion',
      })
    ).toThrow('tabQuestion.kind is invalid')
  })

  test('tabQuestion rejects non-string options', () => {
    expect(() =>
      parseServerMessage({
        payload: { kind: 'question', options: [1, 2], prompt: 'x', sessionId: 's', tabId: 't' },
        type: 'tabQuestion',
      })
    ).toThrow('tabQuestion.options must be a string array when present')
  })
})
