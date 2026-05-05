import { describe, expect, test } from 'bun:test'

import {
  MANAGER_PROTOCOL_MIN_VERSION,
  MANAGER_PROTOCOL_VERSION,
  parseManagerRequest,
  selectManagerProtocolVersion,
} from '../../src/ipc/manager-protocol'

describe('manager protocol', () => {
  test('selects highest mutually supported version', () => {
    expect(
      selectManagerProtocolVersion({
        maxVersion: MANAGER_PROTOCOL_VERSION,
        minVersion: MANAGER_PROTOCOL_MIN_VERSION,
      })
    ).toBe(MANAGER_PROTOCOL_VERSION)
  })

  describe('setBroadcastEnabled', () => {
    test('parses with enabled: true', () => {
      const req = parseManagerRequest({
        id: 'r1',
        payload: { enabled: true },
        type: 'setBroadcastEnabled',
      })
      expect(req.type).toBe('setBroadcastEnabled')
      if (req.type !== 'setBroadcastEnabled') throw new Error('narrowing')
      expect(req.payload.enabled).toBe(true)
    })

    test('parses with enabled: false', () => {
      const req = parseManagerRequest({
        id: 'r2',
        payload: { enabled: false },
        type: 'setBroadcastEnabled',
      })
      if (req.type !== 'setBroadcastEnabled') throw new Error('narrowing')
      expect(req.payload.enabled).toBe(false)
    })

    test('rejects non-boolean enabled', () => {
      expect(() =>
        parseManagerRequest({
          id: 'r3',
          payload: { enabled: 'true' },
          type: 'setBroadcastEnabled',
        })
      ).toThrow('setBroadcastEnabled.enabled must be a boolean')
    })

    test('rejects missing enabled', () => {
      expect(() =>
        parseManagerRequest({
          id: 'r4',
          payload: {},
          type: 'setBroadcastEnabled',
        })
      ).toThrow('setBroadcastEnabled.enabled must be a boolean')
    })
  })
})
