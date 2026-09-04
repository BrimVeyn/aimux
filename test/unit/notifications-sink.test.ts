import type { PluginNotificationEvent } from '@brimveyn/aimux-plugin'

import { afterEach, describe, expect, test } from 'bun:test'

import {
  clearNotificationSink,
  notificationSinkOwner,
  notify,
  registerNotificationSink,
} from '../../src/ui/notifications'

/**
 * One sink, and while it holds the slot aimux delivers nothing itself. The
 * second plugin to ask is refused, because two phones buzzing for one turn
 * is the doubling this slot exists to prevent.
 */
afterEach(() => {
  clearNotificationSink()
})

describe('the notification slot', () => {
  test('one plugin at a time, and the first keeps it', () => {
    const first = registerNotificationSink('acme.ntfy', () => {})
    const second = registerNotificationSink('acme.telegram', () => {})
    expect(first.accepted).toBe(true)
    expect(second.accepted).toBe(false)
    expect(second.reason).toContain('acme.ntfy')
    expect(notificationSinkOwner()).toBe('acme.ntfy')

    first.dispose()
    expect(notificationSinkOwner()).toBeNull()
  })

  test('the sink receives what aimux would have delivered', () => {
    const received: PluginNotificationEvent[] = []
    registerNotificationSink('acme.ntfy', (event) => {
      received.push(event)
    })
    notify({ kind: 'turn-complete', tabId: 't1', title: 'Claude' })
    notify({ kind: 'custom', level: 'info', pluginId: 'acme.other', title: 'hi' })
    expect(received.map((event) => event.kind)).toEqual(['turn-complete', 'custom'])
  })

  test('a throwing sink loses one event and nothing else', () => {
    registerNotificationSink('acme.ntfy', () => {
      throw new Error('offline')
    })
    expect(() => notify({ kind: 'turn-complete', tabId: 't1', title: 'Claude' })).not.toThrow()
  })
})
