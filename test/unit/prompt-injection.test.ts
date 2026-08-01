import { expect, test } from 'bun:test'

import type { SessionBackend } from '../../src/session-backend/types'
import type { AppState, TabSession, TerminalSnapshot } from '../../src/state/types'

import { injectPromptWhenReady } from '../../src/app-runtime/prompt-injection'
import { createInitialState } from '../../src/state/store'
import { createDefaultTerminalModes } from '../../src/state/terminal-modes'

const PROMPT = 'fix the scroll drift'

function screen(text: string): TerminalSnapshot {
  return {
    baseY: 0,
    cursorVisible: true,
    lines: [{ spans: [{ text }] }],
    viewportY: 0,
  } as TerminalSnapshot
}

function tab(overrides: Partial<TabSession> = {}): TabSession {
  return {
    assistant: 'claude',
    buffer: '',
    command: 'claude',
    id: 'tab-1',
    status: 'running',
    terminalModes: createDefaultTerminalModes(),
    title: 'Claude',
    ...overrides,
  }
}

const READY = { ...createDefaultTerminalModes(), bracketedPasteMode: true }

function stateWith(entry: TabSession): AppState {
  return { ...createInitialState(), tabs: [entry] }
}

function fakeBackend() {
  const writes: string[] = []
  const backend = {
    scrollViewportToBottom: () => {},
    write: (_tabId: string, input: string) => void writes.push(input),
  } as unknown as SessionBackend
  return { backend, writes }
}

const noSleep = async () => {}

test('waits for bracketed paste, then pastes and submits once the text shows up', async () => {
  const { backend, writes } = fakeBackend()
  let polls = 0
  const booting = stateWith(tab())
  const ready = stateWith(tab({ terminalModes: READY, viewport: screen(`> ${PROMPT}`) }))

  await injectPromptWhenReady({
    backend,
    getState: () => (polls++ < 3 ? booting : ready),
    prompt: PROMPT,
    sleep: noSleep,
    tabId: 'tab-1',
  })

  expect(polls).toBeGreaterThan(3)
  expect(writes.join('')).toContain(PROMPT)
  expect(writes.at(-1)).toBe('\r')
  // One paste, so no Ctrl+U was needed.
  expect(writes.some((input) => input === '\x15')).toBe(false)
})

test('retries when the assistant swallowed the paste, clearing between attempts', async () => {
  const { backend, writes } = fakeBackend()
  // Claude enables bracketed paste ~350ms before it will accept input; the
  // first pastes land nowhere and the screen keeps showing its placeholder.
  const empty = stateWith(tab({ terminalModes: READY, viewport: screen('> try "fix a bug"') }))
  const echoed = stateWith(tab({ terminalModes: READY, viewport: screen(`> ${PROMPT}`) }))
  let reads = 0

  await injectPromptWhenReady({
    backend,
    getState: () => (reads++ < 5 ? empty : echoed),
    prompt: PROMPT,
    sleep: noSleep,
    tabId: 'tab-1',
  })

  const pastes = writes.filter((input) => input.includes(PROMPT)).length
  expect(pastes).toBeGreaterThan(1)
  // Every retry is preceded by a clear, so nothing stacks in the input box.
  expect(writes.filter((input) => input === '\x15').length).toBe(pastes - 1)
  expect(writes.at(-1)).toBe('\r')
})

test('gives up retrying but still submits, never pasting twice unguarded', async () => {
  const { backend, writes } = fakeBackend()
  const never = stateWith(tab({ terminalModes: READY, viewport: screen('> nothing here') }))

  await injectPromptWhenReady({
    backend,
    getState: () => never,
    maxAttempts: 3,
    prompt: PROMPT,
    sleep: noSleep,
    tabId: 'tab-1',
  })

  expect(writes.filter((input) => input.includes(PROMPT)).length).toBe(3)
  expect(writes.filter((input) => input === '\x15').length).toBe(2)
  expect(writes.at(-1)).toBe('\r')
})

test('a prompt too short to recognise on screen is pasted once, on faith', async () => {
  const { backend, writes } = fakeBackend()
  const blind = stateWith(tab({ terminalModes: READY, viewport: screen('> ') }))

  await injectPromptWhenReady({
    backend,
    getState: () => blind,
    prompt: 'go',
    sleep: noSleep,
    tabId: 'tab-1',
  })

  expect(writes.filter((input) => input.includes('go')).length).toBe(1)
  expect(writes.at(-1)).toBe('\r')
})

test('writes nothing when the tab died on startup', async () => {
  const { backend, writes } = fakeBackend()
  const dead = stateWith(tab({ status: 'error' }))

  await injectPromptWhenReady({
    backend,
    getState: () => dead,
    prompt: PROMPT,
    sleep: noSleep,
    tabId: 'tab-1',
  })

  expect(writes).toEqual([])
})

test('writes nothing for an empty prompt', async () => {
  const { backend, writes } = fakeBackend()

  await injectPromptWhenReady({
    backend,
    getState: () => stateWith(tab({ terminalModes: READY })),
    prompt: '   ',
    sleep: noSleep,
    tabId: 'tab-1',
  })

  expect(writes).toEqual([])
})
