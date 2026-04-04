import { describe, expect, test } from 'bun:test'

import {
  type ClientRequest,
  encodeMessage,
  IPC_PROTOCOL_VERSION,
  type IpcMessage,
  MessageDecoder,
  parseClientRequest,
  parseServerMessage,
} from '../../src/ipc/protocol'

describe('ipc protocol framing', () => {
  test('round-trips messages with embedded newlines', () => {
    const decoder = new MessageDecoder<IpcMessage>()
    const message: ClientRequest = {
      id: '1',
      type: 'write',
      payload: { tabId: 'tab-1', data: 'hello\nworld' },
    }

    expect(decoder.push(encodeMessage(message))).toEqual([message])
  })

  test('handles chunk-split payloads', () => {
    const decoder = new MessageDecoder<IpcMessage>()
    const message: ClientRequest = {
      id: '2',
      type: 'write',
      payload: { tabId: 'tab-2', data: 'split\nacross\nchunks' },
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
      type: 'write',
      payload: { tabId: 'tab-3', data: 'first\nmessage' },
    }
    const second: ClientRequest = {
      id: '4',
      type: 'setActiveTab',
      payload: { tabId: 'tab-4' },
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
        type: 'attach',
        payload: {
          protocolVersion: IPC_PROTOCOL_VERSION,
          sessionId: 'session-a',
          cols: '80',
          rows: 24,
        },
      })
    ).toThrow('attach.cols must be a number')
  })

  test('rejects mismatched attach protocol versions', () => {
    expect(() =>
      parseClientRequest({
        id: '6',
        type: 'attach',
        payload: { protocolVersion: 999, sessionId: 'session-a', cols: 80, rows: 24 },
      })
    ).toThrow(`attach.protocolVersion must be ${IPC_PROTOCOL_VERSION}`)
  })

  test('rejects malformed server event payloads', () => {
    expect(() =>
      parseServerMessage({
        type: 'tabRender',
        payload: {
          tabId: 'tab-1',
          viewport: { lines: [], viewportY: 0, baseY: 0, cursorVisible: true },
          terminalModes: {
            mouseTrackingMode: 'bogus',
            sendFocusMode: false,
            alternateScrollMode: false,
            isAlternateBuffer: false,
            bracketedPasteMode: false,
          },
        },
      })
    ).toThrow('tabRender.terminalModes is invalid')
  })
})
