import { afterEach, describe, expect, mock, test } from 'bun:test'

import {
  type AppEvents,
  clearAppEventListeners,
  emitAppEvent,
  onAppEvent,
} from '../../src/app-runtime/app-events'
import { observeCounters } from '../../src/services/aimux-counters/observe'
import { appStore } from '../../src/state/app-store'
import { createInitialState } from '../../src/state/store'

/**
 * Two funnels already existed — every dispatch that changed state, and every
 * side effect executed — each with one hard-wired consumer. Making them a bus
 * is what lets a plugin see the same stream; the counters become one
 * subscriber among others.
 */

const WORKSPACE = {
  branch: 'main',
  createdAt: '2026-01-01T00:00:00.000Z',
  createdByAimux: false,
  id: 'w1',
  name: 'main',
  path: '/tmp/repo',
  repoRoot: '/tmp/repo',
  source: 'primary' as const,
  updatedAt: '2026-01-01T00:00:00.000Z',
}

afterEach(() => {
  clearAppEventListeners()
  appStore.setState(createInitialState())
})

describe('app event bus', () => {
  test('a dispatch that changes state fires, with both states', () => {
    const seen: AppEvents['action'][] = []
    onAppEvent('action', (payload) => seen.push(payload))

    appStore.getState().dispatch({ type: 'bump-plugin-registry' })

    expect(seen).toHaveLength(1)
    expect(seen[0]?.action.type).toBe('bump-plugin-registry')
    expect(seen[0]?.before.pluginRegistryVersion).toBe(0)
    expect(seen[0]?.after.pluginRegistryVersion).toBe(1)
  })

  test('a declined action does not fire', () => {
    const seen: AppEvents['action'][] = []
    onAppEvent('action', (payload) => seen.push(payload))

    // Nothing to close: the reducer returns the same state.
    appStore.getState().dispatch({ type: 'close-plugin-view' })

    // Reporting it would describe something that never happened.
    expect(seen).toEqual([])
  })

  test('a throwing subscriber does not abort the store update', () => {
    onAppEvent('action', () => {
      throw new Error('plugin listener blew up')
    })
    const after: AppEvents['action'][] = []
    onAppEvent('action', (payload) => after.push(payload))

    expect(() => appStore.getState().dispatch({ type: 'bump-plugin-registry' })).not.toThrow()
    // The listener behind the throwing one still runs...
    expect(after).toHaveLength(1)
    // ...and the state change landed.
    expect(appStore.getState().pluginRegistryVersion).toBe(1)
  })

  test('a listener unsubscribing mid-dispatch does not skip its neighbour', () => {
    const seen: string[] = []
    const dispose = onAppEvent('action', () => {
      seen.push('first')
      dispose()
    })
    onAppEvent('action', () => seen.push('second'))

    emitAppEvent('action', {
      action: { type: 'bump-plugin-registry' },
      after: createInitialState(),
      before: createInitialState(),
    })
    expect(seen).toEqual(['first', 'second'])
  })

  test('disposing stops delivery', () => {
    const seen: unknown[] = []
    const dispose = onAppEvent('effect', (payload) => seen.push(payload))
    emitAppEvent('effect', { effect: { type: 'open-new-tab' } })
    expect(seen).toHaveLength(1)

    dispose()
    emitAppEvent('effect', { effect: { type: 'open-new-tab' } })
    expect(seen).toHaveLength(1)
  })
})

describe('counters as a subscriber', () => {
  test('an effect reaches the counters through the bus, and stops when disposed', () => {
    const counted: string[] = []
    void mock.module('../../src/services/aimux-counters/index', () => ({
      bump: (key: string) => counted.push(key),
      flushCounters: () => {},
      recordOnce: () => {},
      startCounters: () => {},
    }))

    const dispose = observeCounters()
    emitAppEvent('effect', { effect: { type: 'paste-selected-snippet' } })
    expect(counted).toEqual(['snippetsFired'])

    // Nothing about the counters is privileged any more — including whether
    // they are attached at all.
    dispose()
    emitAppEvent('effect', { effect: { type: 'paste-selected-snippet' } })
    expect(counted).toEqual(['snippetsFired'])
  })

  test('an action reaches the counters the same way', () => {
    const counted: string[] = []
    void mock.module('../../src/services/aimux-counters/index', () => ({
      bump: (key: string) => counted.push(key),
      flushCounters: () => {},
      recordOnce: () => {},
      startCounters: () => {},
    }))

    const dispose = observeCounters()
    emitAppEvent('action', {
      action: { projectId: 'p', type: 'add-workspace-record', workspace: WORKSPACE },
      after: createInitialState(),
      before: createInitialState(),
    })
    dispose()
    expect(counted).toEqual(['workspacesCreated'])
  })
})
