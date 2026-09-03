import { describe, expect, test } from 'bun:test'

import {
  createManagerHelloResult,
  MANAGER_CAPABILITY_SET_BROADCAST_ENABLED,
  MANAGER_PROTOCOL_CAPABILITIES,
  MANAGER_PROTOCOL_MIN_VERSION,
  MANAGER_PROTOCOL_VERSION,
  parseManagerMessage,
  parseManagerRequest,
  selectManagerProtocolVersion,
} from '../../src/ipc/manager-protocol'

describe('manager protocol', () => {
  test('requires the v13 breaking-release boundary', () => {
    expect(MANAGER_PROTOCOL_MIN_VERSION).toBe(13)
    expect(MANAGER_PROTOCOL_VERSION).toBe(13)
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

  describe('hello capabilities', () => {
    test('createManagerHelloResult advertises the setBroadcastEnabled capability', () => {
      const result = createManagerHelloResult(MANAGER_PROTOCOL_VERSION)
      expect(result.capabilities).toContain(MANAGER_CAPABILITY_SET_BROADCAST_ENABLED)
      expect(result.capabilities).toEqual([...MANAGER_PROTOCOL_CAPABILITIES])
    })

    test('parseManagerMessage normalises legacy helloResult (no capabilities) to []', () => {
      // Wire-back-compat: a pre-capabilities TM omits the field. The parser
      // must surface `capabilities: []` so callers can `.includes(...)`
      // without a null guard.
      const parsed = parseManagerMessage({
        id: 'h1',
        payload: {
          maxVersion: MANAGER_PROTOCOL_VERSION,
          minVersion: MANAGER_PROTOCOL_VERSION,
          processVersion: '1.0.0',
          selectedVersion: MANAGER_PROTOCOL_VERSION,
        },
        type: 'helloResult',
      })
      expect(parsed).toMatchObject({
        payload: { capabilities: [] },
        type: 'helloResult',
      })
    })

    test('parseManagerMessage preserves advertised capabilities', () => {
      const parsed = parseManagerMessage({
        id: 'h2',
        payload: {
          capabilities: ['setBroadcastEnabled', 'thinAttach'],
          maxVersion: MANAGER_PROTOCOL_VERSION,
          minVersion: MANAGER_PROTOCOL_VERSION,
          processVersion: '1.0.0',
          selectedVersion: MANAGER_PROTOCOL_VERSION,
        },
        type: 'helloResult',
      })
      expect(parsed).toMatchObject({
        payload: { capabilities: ['setBroadcastEnabled', 'thinAttach'] },
        type: 'helloResult',
      })
    })
  })
})

test('parses additive tab metadata updates', () => {
  const request = parseManagerRequest({
    id: 'metadata-1',
    payload: {
      autoRenameStatus: 'attempted',
      projectId: 'project-1',
      tabId: 'tab-1',
      title: 'Cache fix',
    },
    type: 'updateTabMetadata',
  })
  expect(request.type).toBe('updateTabMetadata')
})
