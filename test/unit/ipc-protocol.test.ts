import { describe, expect, test } from 'bun:test'

import {
  type ClientRequest,
  encodeMessage,
  IPC_CAPABILITY_HOT_REEXEC,
  IPC_PROTOCOL_CAPABILITIES,
  IPC_PROTOCOL_VERSION,
  type IpcMessage,
  MessageDecoder,
  negotiateProtocolVersion,
  parseClientRequest,
  parseServerMessage,
} from '../../src/ipc/protocol'

describe('ipc protocol framing', () => {
  test('round-trips messages with embedded newlines', () => {
    const decoder = new MessageDecoder<IpcMessage>()
    const message: ClientRequest = {
      id: '1',
      payload: { data: 'hello\nworld', tabId: 'tab-1' },
      type: 'write',
    }

    expect(decoder.push(encodeMessage(message))).toEqual([message])
  })

  test('handles chunk-split payloads', () => {
    const decoder = new MessageDecoder<IpcMessage>()
    const message: ClientRequest = {
      id: '2',
      payload: { data: 'split\nacross\nchunks', tabId: 'tab-2' },
      type: 'write',
    }
    const frame = encodeMessage(message)

    expect(decoder.push(frame.subarray(0, 5))).toEqual([])
    expect(decoder.push(frame.subarray(5, 17))).toEqual([])
    expect(decoder.push(frame.subarray(17))).toEqual([message])
  })

  test('handles multiple messages in one chunk', () => {
    const decoder = new MessageDecoder<IpcMessage>()
    const first: ClientRequest = {
      id: '3',
      payload: { data: 'first\nmessage', tabId: 'tab-3' },
      type: 'write',
    }
    const second: ClientRequest = {
      id: '4',
      payload: { tabId: 'tab-4' },
      type: 'setActiveTab',
    }

    const combined = Buffer.concat([encodeMessage(first), encodeMessage(second)])
    expect(decoder.push(combined)).toEqual([first, second])
  })

  test('rejects malformed frame headers', () => {
    const decoder = new MessageDecoder<IpcMessage>()
    expect(() => decoder.push('oops\n{}')).toThrow('Invalid IPC frame header: "oops"')
  })

  test('rejects malformed client request payloads', () => {
    expect(() =>
      parseClientRequest({
        id: '5',
        payload: {
          cols: '80',
          protocolVersion: IPC_PROTOCOL_VERSION,
          rows: 24,
          sessionId: 'session-a',
        },
        type: 'attach',
      })
    ).toThrow('attach.cols must be a number')
  })

  test('negotiates the highest compatible protocol version', () => {
    expect(negotiateProtocolVersion(1, IPC_PROTOCOL_VERSION, 2, IPC_PROTOCOL_VERSION)).toBe(
      IPC_PROTOCOL_VERSION
    )
    expect(negotiateProtocolVersion(3, 4, 1, 2)).toBeNull()
  })

  test('accepts hello responses with negotiated protocol metadata', () => {
    expect(
      parseServerMessage({
        id: '6',
        payload: {
          capabilities: ['thinAttach'],
          maxVersion: IPC_PROTOCOL_VERSION,
          minVersion: 2,
          processVersion: '1.2.3',
          selectedVersion: IPC_PROTOCOL_VERSION,
        },
        type: 'helloResult',
      })
    ).toMatchObject({
      payload: { capabilities: ['thinAttach'] },
      type: 'helloResult',
    })
  })

  test('advertises hotReexec in the default capability set', () => {
    // The capability gate that bootstrap.ts checks before sending
    // prepareReexec. If this constant ever drops from the default set, the
    // hot-reexec path silently regresses to the legacy stopTM+restart flow
    // — surface that loudly here so it's an obvious mistake.
    expect(IPC_PROTOCOL_CAPABILITIES).toContain(IPC_CAPABILITY_HOT_REEXEC)
  })

  test('parses prepareReexec requests, with and without a reason', () => {
    expect(
      parseClientRequest({
        id: 'r1',
        payload: {},
        type: 'prepareReexec',
      })
    ).toMatchObject({ type: 'prepareReexec' })

    expect(
      parseClientRequest({
        id: 'r2',
        payload: { reason: 'binary-update' },
        type: 'prepareReexec',
      })
    ).toMatchObject({
      payload: { reason: 'binary-update' },
      type: 'prepareReexec',
    })

    expect(() =>
      parseClientRequest({
        id: 'r3',
        payload: { reason: 42 },
        type: 'prepareReexec',
      })
    ).toThrow('prepareReexec.reason must be a string when present')
  })

  test('parses reexecAck responses', () => {
    expect(
      parseServerMessage({
        id: 'r4',
        payload: { handoffPath: '/tmp/d.handoff', renamedSocketPath: '/tmp/d.old.sock' },
        type: 'reexecAck',
      })
    ).toMatchObject({
      payload: { handoffPath: '/tmp/d.handoff', renamedSocketPath: '/tmp/d.old.sock' },
      type: 'reexecAck',
    })

    expect(() =>
      parseServerMessage({
        id: 'r5',
        payload: { handoffPath: 42, renamedSocketPath: '/tmp/d.old.sock' },
        type: 'reexecAck',
      })
    ).toThrow('reexecAck.handoffPath must be a string')
  })

  test('normalises legacy hello responses without capabilities to an empty list', () => {
    // Wire-back-compat: a pre-capability daemon sends `helloResult` with no
    // `capabilities` field. The parser must accept it and surface
    // `capabilities: []` so consumers can call `.includes(...)` without a
    // null guard.
    const parsed = parseServerMessage({
      id: '7',
      payload: {
        maxVersion: IPC_PROTOCOL_VERSION,
        minVersion: 2,
        processVersion: '1.2.3',
        selectedVersion: IPC_PROTOCOL_VERSION,
      },
      type: 'helloResult',
    })
    expect(parsed).toMatchObject({
      payload: { capabilities: [] },
      type: 'helloResult',
    })
  })

  test('rejects malformed server event payloads', () => {
    expect(() =>
      parseServerMessage({
        payload: {
          tabId: 'tab-1',
          terminalModes: {
            alternateScrollMode: false,
            bracketedPasteMode: false,
            isAlternateBuffer: false,
            mouseTrackingMode: 'bogus',
            sendFocusMode: false,
          },
          viewport: { baseY: 0, cursorVisible: true, lines: [], viewportY: 0 },
        },
        type: 'tabRender',
      })
    ).toThrow('tabRender.terminalModes is invalid')
  })

  test('parses tabStatus and sessionStatus events', () => {
    expect(
      parseServerMessage({
        payload: { sessionId: 'session-1', status: 'working', tabId: 'tab-1' },
        type: 'tabStatus',
      })
    ).toMatchObject({ type: 'tabStatus' })
    expect(
      parseServerMessage({
        payload: { sessionId: 'session-1', status: { waiting: true, working: false } },
        type: 'sessionStatus',
      })
    ).toMatchObject({ type: 'sessionStatus' })
    expect(() =>
      parseServerMessage({
        payload: { sessionId: 'session-1', status: 'bogus', tabId: 'tab-1' },
        type: 'tabStatus',
      })
    ).toThrow('tabStatus.status is invalid')
    expect(() =>
      parseServerMessage({
        payload: { sessionId: 'session-1', status: { waiting: 1, working: true } },
        type: 'sessionStatus',
      })
    ).toThrow('sessionStatus.status is invalid')
  })
})
