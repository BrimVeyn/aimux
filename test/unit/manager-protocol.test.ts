import { describe, expect, test } from 'bun:test'

import {
  MANAGER_PROTOCOL_MIN_VERSION,
  MANAGER_PROTOCOL_VERSION,
  parseManagerRequest,
  selectManagerProtocolVersion,
} from '../../src/ipc/manager-protocol'

describe('manager protocol', () => {
  test('rejects v3 TMs (broadcast-gate fix is breaking at v4)', () => {
    // A pre-fix TM offers max=3, min=3. A post-fix daemon offers min=4 — they
    // do not overlap, so handshake fails. This is intentional: the breaking
    // update flow then fires to kill+respawn the TM at v4.
    expect(selectManagerProtocolVersion({ maxVersion: 3, minVersion: 3 })).toBe(null)
  })

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
