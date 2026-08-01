import { describe, expect, test } from 'bun:test'

import { IPC_PROTOCOL_MIN_VERSION, IPC_PROTOCOL_VERSION } from '../../src/ipc/protocol'

describe('ipc protocol v17 breaking boundary', () => {
  test('refuses peers from before the worker control plane', () => {
    // MIN is the boundary and stays put; MAX moves forward with every additive
    // version (v18 added `workspaceId` to the status broadcasts), so pinning it
    // here would make every additive change look like a breaking one.
    expect(IPC_PROTOCOL_MIN_VERSION).toBe(17)
    expect(IPC_PROTOCOL_VERSION).toBeGreaterThanOrEqual(17)
  })
})
