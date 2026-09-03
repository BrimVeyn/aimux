import { afterEach, describe, expect, test } from 'bun:test'

import {
  clearDaemonEventListeners,
  type DaemonEvents,
  emitDaemonEvent,
  onDaemonEvent,
} from '../../src/daemon/daemon-events'

/**
 * The daemon already knew every one of these — it knows a turn ended precisely
 * because it is about to tell the UI. Emitting locally first costs a function
 * call and makes the same knowledge available in-process, which is the whole of
 * what a "react to what the agents are doing" plugin needs.
 */

afterEach(() => {
  clearDaemonEventListeners()
})

describe('daemon event bus', () => {
  test('delivers a payload to its subscriber', () => {
    const seen: DaemonEvents['tab:turnComplete'][] = []
    onDaemonEvent('tab:turnComplete', (payload) => seen.push(payload))

    emitDaemonEvent('tab:turnComplete', { idleMs: 1200, projectId: 'p1', tabId: 't1' })

    expect(seen).toEqual([{ idleMs: 1200, projectId: 'p1', tabId: 't1' }])
  })

  test('events are kept apart', () => {
    const turns: unknown[] = []
    const statuses: unknown[] = []
    onDaemonEvent('tab:turnComplete', (payload) => turns.push(payload))
    onDaemonEvent('tab:status', (payload) => statuses.push(payload))

    emitDaemonEvent('tab:status', { projectId: 'p1', status: 'working', tabId: 't1' })

    expect(turns).toEqual([])
    expect(statuses).toHaveLength(1)
  })

  test('a throwing subscriber does not stop the next one', () => {
    const after: unknown[] = []
    onDaemonEvent('tab:status', () => {
      throw new Error('plugin listener blew up')
    })
    onDaemonEvent('tab:status', (payload) => after.push(payload))

    // This fires inside the status-detection loop and inside the socket
    // handlers; a plugin must not be able to stop a broadcast the UI waits on.
    expect(() =>
      emitDaemonEvent('tab:status', { projectId: 'p1', status: 'idle', tabId: 't1' })
    ).not.toThrow()
    expect(after).toHaveLength(1)
  })

  test('a listener unsubscribing mid-dispatch does not skip its neighbour', () => {
    const seen: string[] = []
    const dispose = onDaemonEvent('tab:status', () => {
      seen.push('first')
      dispose()
    })
    onDaemonEvent('tab:status', () => seen.push('second'))

    emitDaemonEvent('tab:status', { projectId: 'p1', status: 'idle', tabId: 't1' })
    expect(seen).toEqual(['first', 'second'])
  })

  test('disposing stops delivery', () => {
    const seen: unknown[] = []
    const dispose = onDaemonEvent('project:switched', (payload) => seen.push(payload))
    emitDaemonEvent('project:switched', { projectId: 'p1' })
    dispose()
    emitDaemonEvent('project:switched', { projectId: 'p2' })
    expect(seen).toHaveLength(1)
  })

  test('emitting with no subscribers is free and silent', () => {
    expect(() => emitDaemonEvent('daemon:reexec', { reason: 'update' })).not.toThrow()
  })
})
