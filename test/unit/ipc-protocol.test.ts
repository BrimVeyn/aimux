import { describe, expect, test } from 'bun:test'

import {
  encodeMessage,
  MessageDecoder,
  type ClientRequest,
  type IpcMessage,
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
})
