import { describe, expect, test } from 'bun:test'

import type { DaemonClient } from '../../src/cli/client/daemon-client'
import type { CliContext } from '../../src/cli/context'
import type { SessionRecord } from '../../src/state/types'

import { tabAwait } from '../../src/cli/commands/tab/await'
import { awaitTurn } from '../../src/cli/commands/tab/await-turn'

/**
 * Drives `awaitTurn` against a fake daemon whose `on(type, handler)` feeds a
 * registry we can emit into, so the event-driven settle logic and the
 * `assumeWorking` uptake guard are exercised without a live socket.
 */
type Handler = (payload: Record<string, unknown>) => void

function makeEmitterDaemon(): { daemon: DaemonClient; emit: (type: string, p: unknown) => void } {
  const handlers = new Map<string, Set<Handler>>()
  const emit = (type: string, p: unknown): void => {
    for (const h of handlers.get(type) ?? []) h(p as Record<string, unknown>)
  }
  const daemon = {
    on: (type: string, handler: Handler) => {
      const set = handlers.get(type) ?? new Set<Handler>()
      set.add(handler)
      handlers.set(type, set)
      return () => set.delete(handler)
    },
  } as unknown as DaemonClient
  return { daemon, emit }
}

const TAB = 'tab-1'

describe('awaitTurn', () => {
  test('tabTurnComplete without prior working is ignored (assumeWorking false) → timeout', async () => {
    const { daemon, emit } = makeEmitterDaemon()
    const p = awaitTurn({ assumeWorking: false, daemon, tabId: TAB, timeoutMs: 30 })
    emit('tabTurnComplete', { tabId: TAB })
    expect((await p).outcome).toBe('timeout')
  })

  test('tabTurnComplete completes immediately when assumeWorking is true', async () => {
    const { daemon, emit } = makeEmitterDaemon()
    const p = awaitTurn({ assumeWorking: true, daemon, tabId: TAB, timeoutMs: 1000 })
    emit('tabTurnComplete', { tabId: TAB })
    expect((await p).outcome).toBe('completed')
  })

  test('a working transition then tabTurnComplete completes (uptake guard cleared)', async () => {
    const { daemon, emit } = makeEmitterDaemon()
    const p = awaitTurn({ assumeWorking: false, daemon, tabId: TAB, timeoutMs: 1000 })
    emit('tabStatus', { status: 'working', tabId: TAB })
    emit('tabTurnComplete', { tabId: TAB })
    expect((await p).outcome).toBe('completed')
  })

  test('tabQuestion settles immediately even before any working transition', async () => {
    const { daemon, emit } = makeEmitterDaemon()
    const p = awaitTurn({ assumeWorking: false, daemon, tabId: TAB, timeoutMs: 1000 })
    emit('tabQuestion', {
      kind: 'permission',
      options: ['yes', 'no'],
      prompt: 'allow?',
      tabId: TAB,
    })
    const outcome = await p
    expect(outcome.outcome).toBe('question')
    if (outcome.outcome === 'question') {
      expect(outcome.question).toBe('allow?')
      expect(outcome.options).toEqual(['yes', 'no'])
    }
  })

  test('events for other tabs are ignored', async () => {
    const { daemon, emit } = makeEmitterDaemon()
    const p = awaitTurn({ assumeWorking: true, daemon, tabId: TAB, timeoutMs: 30 })
    emit('tabTurnComplete', { tabId: 'other' })
    expect((await p).outcome).toBe('timeout')
  })

  test('tabExit / tabError settle as error', async () => {
    const { daemon: d1, emit: e1 } = makeEmitterDaemon()
    const p1 = awaitTurn({ assumeWorking: false, daemon: d1, tabId: TAB, timeoutMs: 1000 })
    e1('tabExit', { exitCode: 1, tabId: TAB })
    const o1 = await p1
    expect(o1.outcome).toBe('error')
    if (o1.outcome === 'error') expect(o1.error).toBe('exit 1')

    const { daemon: d2, emit: e2 } = makeEmitterDaemon()
    const p2 = awaitTurn({ assumeWorking: false, daemon: d2, tabId: TAB, timeoutMs: 1000 })
    e2('tabError', { message: 'boom', tabId: TAB })
    const o2 = await p2
    expect(o2.outcome).toBe('error')
    if (o2.outcome === 'error') expect(o2.error).toBe('boom')
  })

  test('onArmed runs and its rejection settles as error', async () => {
    const { daemon } = makeEmitterDaemon()
    let armed = false
    const outcome = await awaitTurn({
      assumeWorking: false,
      daemon,
      onArmed: async () => {
        armed = true
        throw new Error('write failed')
      },
      tabId: TAB,
      timeoutMs: 1000,
    })
    expect(armed).toBe(true)
    expect(outcome.outcome).toBe('error')
    if (outcome.outcome === 'error') expect(outcome.error).toBe('write failed')
  })
})

// ── tabAwait.run seeding from the attach replay ──────────────────────────────

interface FakeTab {
  id: string
  activity?: 'idle' | 'waiting-input' | 'working'
  viewport?: unknown
}

function makeAwaitDaemon(tabs: FakeTab[]): {
  daemon: DaemonClient
  emit: (type: string, p: unknown) => void
} {
  const handlers = new Map<string, Set<Handler>>()
  const emit = (type: string, p: unknown): void => {
    for (const h of handlers.get(type) ?? []) h(p as Record<string, unknown>)
  }
  const daemon = {
    attach: async () => ({ activeTabId: null, tabs }),
    hasCapability: () => true,
    on: (type: string, handler: Handler) => {
      const set = handlers.get(type) ?? new Set<Handler>()
      set.add(handler)
      handlers.set(type, set)
      return () => set.delete(handler)
    },
  } as unknown as DaemonClient
  return { daemon, emit }
}

function makeCtx(
  flags: Record<string, string | number | boolean>,
  positionals: string[],
  daemon: DaemonClient
): CliContext {
  return {
    args: { flags, positionals },
    getDaemon: async () => daemon,
    getWorkspace: () => ({ id: 'ws' }) as unknown as SessionRecord,
  }
}

async function captureJson(run: () => Promise<number>): Promise<{ code: number; json: unknown }> {
  const chunks: string[] = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
    return true
  }) as typeof process.stdout.write
  try {
    const code = await run()
    return { code, json: JSON.parse(chunks.join('')) }
  } finally {
    process.stdout.write = original
  }
}

const tick = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0))
}

describe('tabAwait.run seeding', () => {
  test('a working tab completes on a bare tabTurnComplete', async () => {
    const { daemon, emit } = makeAwaitDaemon([{ activity: 'working', id: TAB }])
    const ctx = makeCtx({ timeout: 1000 }, [TAB], daemon)
    const { code, json } = await captureJson(async () => {
      const p = tabAwait.run(ctx)
      await tick()
      emit('tabTurnComplete', { tabId: TAB })
      return p
    })
    expect(code).toBe(0)
    expect((json as { outcome: string }).outcome).toBe('completed')
  })

  test('an already waiting-input tab returns question immediately (exit 10)', async () => {
    const { daemon } = makeAwaitDaemon([{ activity: 'waiting-input', id: TAB }])
    const ctx = makeCtx({ timeout: 1000 }, [TAB], daemon)
    const { code, json } = await captureJson(async () => await tabAwait.run(ctx))
    expect(code).toBe(10)
    const out = json as { durationMs: number; outcome: string; question: string }
    expect(out.outcome).toBe('question')
    expect(out.question).toBe('') // no viewport → best-effort empty prompt
    expect(out.durationMs).toBe(0)
  })

  test('an idle tab waits for a fresh cycle — a bare tabTurnComplete does not settle', async () => {
    const { daemon, emit } = makeAwaitDaemon([{ activity: 'idle', id: TAB }])
    const ctx = makeCtx({ timeout: 25 }, [TAB], daemon)
    const { json } = await captureJson(async () => {
      const p = tabAwait.run(ctx)
      await tick()
      emit('tabTurnComplete', { tabId: TAB }) // stale — ignored (no working seen)
      return p
    })
    expect((json as { outcome: string }).outcome).toBe('timeout')
  })

  test('a missing tab throws (runner maps to exit 3)', async () => {
    const { daemon } = makeAwaitDaemon([])
    const ctx = makeCtx({ timeout: 1000 }, ['nope'], daemon)
    let message = ''
    try {
      await tabAwait.run(ctx)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain('tab not found: nope')
  })
})
