import { describe, expect, test } from 'bun:test'

import { IPC_PROTOCOL_MIN_VERSION, IPC_PROTOCOL_VERSION } from '../../src/ipc/protocol'

describe('ipc protocol v16 breaking boundary', () => {
  test('requires exact-version app and daemon peers', () => {
    expect(IPC_PROTOCOL_MIN_VERSION).toBe(16)
    expect(IPC_PROTOCOL_VERSION).toBe(16)
  })
})
