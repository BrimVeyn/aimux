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

  test('rejects mismatched attach protocol versions', () => {
    expect(() =>
      parseClientRequest({
        id: '6',
        payload: { cols: 80, protocolVersion: 999, rows: 24, sessionId: 'session-a' },
        type: 'attach',
      })
    ).toThrow(`attach.protocolVersion must be ${IPC_PROTOCOL_VERSION}`)
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
})
