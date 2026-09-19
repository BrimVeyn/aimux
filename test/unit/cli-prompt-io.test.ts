import { describe, expect, test } from 'bun:test'

import type { DaemonClient } from '../../src/cli/client/daemon-client'

import { buildPromptPayload, writePromptPayload } from '../../src/cli/commands/tab/prompt-io'

function makeFakeDaemon(): { daemon: DaemonClient; writes: string[] } {
  const writes: string[] = []
  const daemon = {
    expectOk: async (_type: string, payload: { data: string; tabId: string }) => {
      writes.push(payload.data)
    },
  } as unknown as DaemonClient
  return { daemon, writes }
}

describe('prompt payload', () => {
  test('a long single line is written as one bracketed paste, then a separate Enter', async () => {
    // Regression: a 1422-byte single line reached Claude Code in ~1 KiB tty
    // reads, each taken as its own unbracketed paste and dropped on submit.
    const text = `${"l'étape suivante consiste à vérifier le socle. ".repeat(30)}fin`
    const { daemon, writes } = makeFakeDaemon()
    const payload = buildPromptPayload(text, false)
    expect(payload.bracketed).toBe(true)

    const bytesWritten = await writePromptPayload(daemon, 'tab-1', payload, true)

    expect(writes).toEqual([`\x1b[200~${text}\x1b[201~`, '\r'])
    expect(bytesWritten).toBe(Buffer.byteLength(writes.join(''), 'utf8'))
  })

  test('a short single line is still typed plainly', () => {
    expect(buildPromptPayload('git status', false)).toEqual({
      bracketed: false,
      data: 'git status',
    })
  })

  test('--keys is never wrapped, however long', () => {
    const chord = '<Up>'.repeat(200)
    const payload = buildPromptPayload(chord, true)
    expect(payload.bracketed).toBe(false)
    expect(payload.data).toBe('\x1b[A'.repeat(200))
  })
})
