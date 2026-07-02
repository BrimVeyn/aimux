import { describe, expect, test } from 'bun:test'

import type { DaemonClient } from '../../src/cli/client/daemon-client'
import type { CliContext } from '../../src/cli/context'
import type { SessionRecord } from '../../src/state/types'

import { tabSend } from '../../src/cli/commands/tab/send'
import { IPC_CAPABILITY_THIN_ATTACH } from '../../src/ipc/protocol'

/**
 * These tests drive `tabSend.run` against a hand-rolled fake daemon so the
 * --await-submit uptake logic can be exercised without a live socket. The fake
 * records writes and lets each test decide whether (and when) to emit the
 * `working` transition that confirms uptake.
 */

type TabStatusHandler = (payload: {
  sessionId: string
  status: 'idle' | 'waiting-input' | 'working'
  tabId: string
}) => void

interface FakeDaemonOptions {
  /** Emit a `working` tabStatus for this tab once the submit `\r` is written. */
  emitWorkingOnEnter?: string
}

function makeFakeDaemon(opts: FakeDaemonOptions): { daemon: DaemonClient; writes: string[] } {
  const writes: string[] = []
  let statusHandler: TabStatusHandler | null = null

  const daemon = {
    attach: async () => ({ tabs: [] }),
    expectOk: async (_type: string, payload: { data: string; tabId: string }) => {
      writes.push(payload.data)
      if (payload.data === '\r' && opts.emitWorkingOnEnter !== undefined) {
        const tabId = opts.emitWorkingOnEnter
        // Mirror the daemon's async event delivery: the transition arrives on a
        // later tick, after `run` has subscribed and issued the write.
        setTimeout(() => {
          statusHandler?.({ sessionId: 'ws', status: 'working', tabId })
        }, 0)
      }
    },
    hasCapability: (name: string) => name === IPC_CAPABILITY_THIN_ATTACH,
    on: (_type: string, handler: TabStatusHandler) => {
      statusHandler = handler
      return () => {
        statusHandler = null
      }
    },
  } as unknown as DaemonClient

  return { daemon, writes }
}

function makeContext(
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

/** Capture the single JSON line a command writes to stdout. */
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

describe('tab send --await-submit', () => {
  test('rejects --await-submit without --enter', async () => {
    const { daemon } = makeFakeDaemon({})
    const ctx = makeContext({ 'await-submit': true }, ['tab-1', 'hi'], daemon)
    let message = ''
    try {
      await tabSend.run(ctx)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain('--await-submit requires --enter')
  })

  test('confirms uptake when the tab transitions to working', async () => {
    const { daemon, writes } = makeFakeDaemon({ emitWorkingOnEnter: 'tab-1' })
    const ctx = makeContext({ 'await-submit': true, 'enter': true }, ['tab-1', 'hello'], daemon)
    const { code, json } = await captureJson(async () => await tabSend.run(ctx))
    expect(code).toBe(0)
    const out = json as {
      bytesWritten: number
      ok: boolean
      submitted: boolean
      uptake: { confirmed: boolean; ms?: number }
    }
    expect(out.ok).toBe(true)
    expect(out.submitted).toBe(true)
    expect(out.uptake.confirmed).toBe(true)
    expect(typeof out.uptake.ms).toBe('number')
    // payload write + the submit \r.
    expect(writes.at(-1)).toBe('\r')
  })

  test('reports unconfirmed uptake when the transition never arrives before timeout', async () => {
    const { daemon } = makeFakeDaemon({}) // never emits working
    const ctx = makeContext(
      { 'await-submit': true, 'await-timeout': 20, 'enter': true },
      ['tab-1', 'hello'],
      daemon
    )
    const { code, json } = await captureJson(async () => await tabSend.run(ctx))
    expect(code).toBe(0)
    const out = json as { ok: boolean; submitted: boolean; uptake: { confirmed: boolean } }
    expect(out.submitted).toBe(true)
    expect(out.uptake.confirmed).toBe(false)
  })

  test('non-await path output is unchanged', async () => {
    const { daemon } = makeFakeDaemon({})
    const ctx = makeContext({ enter: true }, ['tab-1', 'hello'], daemon)
    const { code, json } = await captureJson(async () => await tabSend.run(ctx))
    expect(code).toBe(0)
    const out = json as Record<string, unknown>
    expect(out.ok).toBe(true)
    expect('submitted' in out).toBe(false)
    expect('uptake' in out).toBe(false)
  })
})
