import { expect, test } from 'bun:test'

import { runSuggestion } from '../../src/auto-commit/suggestion-runner'

function makeFakeSpawn(opts: {
  stdout: string
  exitCode?: number
  delayMs?: number
  onAbort?: () => void
}) {
  return function fakeSpawn(
    _invocation: { executable: string; args: string[] },
    signal: AbortSignal
  ) {
    return new Promise<{ stdout: string; exitCode: number } | null>((resolve) => {
      const timer = setTimeout(() => {
        resolve({ exitCode: opts.exitCode ?? 0, stdout: opts.stdout })
      }, opts.delayMs ?? 0)
      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        opts.onAbort?.()
        resolve(null)
      })
    })
  }
}

test('returns parsed suggestion on success', async () => {
  const ctrl = new AbortController()
  const out = await runSuggestion({
    invocation: { args: ['-p', 'hello'], executable: 'claude' },
    signal: ctrl.signal,
    spawn: makeFakeSpawn({ exitCode: 0, stdout: 'TITLE: t\nBODY:\nbody' }),
    timeoutMs: 1000,
  })
  expect(out).toEqual({ body: 'body', title: 't' })
})

test('returns null on non-zero exit', async () => {
  const ctrl = new AbortController()
  const out = await runSuggestion({
    invocation: { args: ['-p', 'hello'], executable: 'claude' },
    signal: ctrl.signal,
    spawn: makeFakeSpawn({ exitCode: 1, stdout: '' }),
    timeoutMs: 1000,
  })
  expect(out).toBeNull()
})

test('returns null on unparseable stdout', async () => {
  const ctrl = new AbortController()
  const out = await runSuggestion({
    invocation: { args: ['-p', 'hello'], executable: 'claude' },
    signal: ctrl.signal,
    spawn: makeFakeSpawn({ exitCode: 0, stdout: 'sorry, I cannot help with that' }),
    timeoutMs: 1000,
  })
  expect(out).toBeNull()
})

test('returns null and aborts on external abort', async () => {
  const ctrl = new AbortController()
  let aborted = false
  const p = runSuggestion({
    invocation: { args: ['-p', 'hello'], executable: 'claude' },
    signal: ctrl.signal,
    spawn: makeFakeSpawn({
      delayMs: 500,
      exitCode: 0,
      onAbort: () => {
        aborted = true
      },
      stdout: 'TITLE: t\nBODY:\n',
    }),
    timeoutMs: 10_000,
  })
  ctrl.abort()
  expect(await p).toBeNull()
  expect(aborted).toBe(true)
})

test('returns null on timeout', async () => {
  const ctrl = new AbortController()
  let aborted = false
  const out = await runSuggestion({
    invocation: { args: ['-p', 'hello'], executable: 'claude' },
    signal: ctrl.signal,
    spawn: makeFakeSpawn({
      delayMs: 500,
      exitCode: 0,
      onAbort: () => {
        aborted = true
      },
      stdout: 'TITLE: t\nBODY:\n',
    }),
    timeoutMs: 50,
  })
  expect(out).toBeNull()
  expect(aborted).toBe(true)
})
