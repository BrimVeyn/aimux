import { describe, expect, test } from 'bun:test'

import { AssistantStatusArbiter } from '../../src/pty/assistant-status-arbiter'

describe('AssistantStatusArbiter', () => {
  test('with no hook events, returns the visual verdict unchanged', () => {
    const arb = new AssistantStatusArbiter()
    expect(arb.arbitrate('pane-1', 'idle', 1_000)).toBe('idle')
    expect(arb.arbitrate('pane-1', 'working', 1_000)).toBe('working')
    expect(arb.arbitrate('pane-1', 'waiting-input', 1_000)).toBe('waiting-input')
  })

  test('UserPromptSubmit / PreToolUse / PostToolUse map to working', () => {
    const arb = new AssistantStatusArbiter()
    for (const event of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse']) {
      const mapped = arb.recordHookEvent({
        hookEventName: event,
        paneId: `p-${event}`,
        payload: {},
        receivedAt: 0,
      })
      expect(mapped).toBe('working')
    }
  })

  test('Stop maps to idle', () => {
    const arb = new AssistantStatusArbiter()
    expect(
      arb.recordHookEvent({ hookEventName: 'Stop', paneId: 'p', payload: {}, receivedAt: 0 })
    ).toBe('idle')
  })

  test('Notification maps to waiting-input', () => {
    const arb = new AssistantStatusArbiter()
    expect(
      arb.recordHookEvent({
        hookEventName: 'Notification',
        paneId: 'p',
        payload: {},
        receivedAt: 0,
      })
    ).toBe('waiting-input')
  })

  test('SubagentStop is ignored (returns null, does not record)', () => {
    const arb = new AssistantStatusArbiter()
    const mapped = arb.recordHookEvent({
      hookEventName: 'SubagentStop',
      paneId: 'p',
      payload: {},
      receivedAt: 0,
    })
    expect(mapped).toBeNull()
    // Visual still wins because no hook was recorded.
    expect(arb.arbitrate('p', 'working', 1_000)).toBe('working')
  })

  test('events with parent_tool_use_id are ignored (subagent-scoped)', () => {
    const arb = new AssistantStatusArbiter()
    const mapped = arb.recordHookEvent({
      hookEventName: 'PreToolUse',
      paneId: 'p',
      payload: { parent_tool_use_id: 'tool_abc' },
      receivedAt: 0,
    })
    expect(mapped).toBeNull()
    expect(arb.arbitrate('p', 'idle', 1_000)).toBe('idle')
  })

  test('empty-string parent_tool_use_id does not count as a subagent event', () => {
    const arb = new AssistantStatusArbiter()
    const mapped = arb.recordHookEvent({
      hookEventName: 'PreToolUse',
      paneId: 'p',
      payload: { parent_tool_use_id: '' },
      receivedAt: 0,
    })
    expect(mapped).toBe('working')
  })

  test('unknown hook event names are ignored', () => {
    const arb = new AssistantStatusArbiter()
    const mapped = arb.recordHookEvent({
      hookEventName: 'SomethingBrandNew',
      paneId: 'p',
      payload: {},
      receivedAt: 0,
    })
    expect(mapped).toBeNull()
  })

  test('within the 10s authority window, hook state overrides visual', () => {
    const arb = new AssistantStatusArbiter()
    arb.recordHookEvent({
      hookEventName: 'PreToolUse',
      paneId: 'p',
      payload: {},
      receivedAt: 1_000,
    })
    // Visual says idle (e.g. Ctrl+T overlay blanked the buffer) but hook
    // says we're mid-tool: trust the hook.
    expect(arb.arbitrate('p', 'idle', 1_500)).toBe('working')
  })

  test('after the 10s window, visual takes over', () => {
    const arb = new AssistantStatusArbiter()
    arb.recordHookEvent({
      hookEventName: 'PreToolUse',
      paneId: 'p',
      payload: {},
      receivedAt: 0,
    })
    expect(arb.arbitrate('p', 'idle', 10_000)).toBe('idle')
    expect(arb.arbitrate('p', 'idle', 999_999)).toBe('idle')
  })

  test('visual waiting-input always wins, even if hook says working', () => {
    const arb = new AssistantStatusArbiter()
    arb.recordHookEvent({
      hookEventName: 'PreToolUse',
      paneId: 'p',
      payload: {},
      receivedAt: 1_000,
    })
    // A bash permission prompt that doesn't fire Notification — the visual
    // detector spots `do you want to proceed?` and we trust it.
    expect(arb.arbitrate('p', 'waiting-input', 1_100)).toBe('waiting-input')
  })

  test('visual waiting-input wins even if hook says idle', () => {
    const arb = new AssistantStatusArbiter()
    arb.recordHookEvent({
      hookEventName: 'Stop',
      paneId: 'p',
      payload: {},
      receivedAt: 1_000,
    })
    // Stop fired but a lingering `tab to amend` prompt is showing.
    expect(arb.arbitrate('p', 'waiting-input', 1_100)).toBe('waiting-input')
  })

  test('Stop → idle within window overrides a stale "working" visual', () => {
    const arb = new AssistantStatusArbiter()
    arb.recordHookEvent({
      hookEventName: 'Stop',
      paneId: 'p',
      payload: {},
      receivedAt: 1_000,
    })
    expect(arb.arbitrate('p', 'working', 1_100)).toBe('idle')
  })

  test('per-pane isolation: hook on one pane does not affect another', () => {
    const arb = new AssistantStatusArbiter()
    arb.recordHookEvent({
      hookEventName: 'PreToolUse',
      paneId: 'p-a',
      payload: {},
      receivedAt: 1_000,
    })
    expect(arb.arbitrate('p-a', 'idle', 1_500)).toBe('working')
    expect(arb.arbitrate('p-b', 'idle', 1_500)).toBe('idle')
  })

  test('a later hook supersedes an earlier one on the same pane', () => {
    const arb = new AssistantStatusArbiter()
    arb.recordHookEvent({
      hookEventName: 'PreToolUse',
      paneId: 'p',
      payload: {},
      receivedAt: 1_000,
    })
    arb.recordHookEvent({
      hookEventName: 'Stop',
      paneId: 'p',
      payload: {},
      receivedAt: 2_000,
    })
    expect(arb.arbitrate('p', 'working', 2_100)).toBe('idle')
  })

  test('forget() drops the hook entry, falling back to visual', () => {
    const arb = new AssistantStatusArbiter()
    arb.recordHookEvent({
      hookEventName: 'PreToolUse',
      paneId: 'p',
      payload: {},
      receivedAt: 1_000,
    })
    arb.forget('p')
    expect(arb.arbitrate('p', 'idle', 1_500)).toBe('idle')
  })

  test('clear() drops every hook entry', () => {
    const arb = new AssistantStatusArbiter()
    arb.recordHookEvent({
      hookEventName: 'PreToolUse',
      paneId: 'p-a',
      payload: {},
      receivedAt: 1_000,
    })
    arb.recordHookEvent({
      hookEventName: 'PreToolUse',
      paneId: 'p-b',
      payload: {},
      receivedAt: 1_000,
    })
    arb.clear()
    expect(arb.arbitrate('p-a', 'idle', 1_500)).toBe('idle')
    expect(arb.arbitrate('p-b', 'idle', 1_500)).toBe('idle')
  })

  test('SubagentStop with parent_tool_use_id present is still ignored (does not record)', () => {
    const arb = new AssistantStatusArbiter()
    const mapped = arb.recordHookEvent({
      hookEventName: 'SubagentStop',
      paneId: 'p',
      payload: { parent_tool_use_id: 'tool_x' },
      receivedAt: 0,
    })
    expect(mapped).toBeNull()
    expect(arb.arbitrate('p', 'working', 100)).toBe('working')
  })
})
