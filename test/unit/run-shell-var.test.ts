import { describe, expect, test } from 'bun:test'

import { runShellVar } from '../../src/snippets/run-shell-var'

describe('runShellVar', () => {
  test('returns trimmed stdout on success', async () => {
    const out = await runShellVar('greet', { sh: "echo 'hello world'" })
    expect(out).toBe('hello world')
  })

  test('supports pipes, &&, and subshells via sh -c', async () => {
    const out = await runShellVar('chain', {
      sh: "echo 'A B C' | tr ' ' '_' && echo done",
    })
    expect(out).toBe('A_B_C\ndone')
  })

  test('returns empty string on non-zero exit', async () => {
    const out = await runShellVar('fail', { sh: 'exit 1' })
    expect(out).toBe('')
  })

  test('returns empty string on timeout', async () => {
    const out = await runShellVar('slow', { sh: 'sleep 5', timeout: 80 })
    expect(out).toBe('')
  })

  test('does not trim when trim: false', async () => {
    const out = await runShellVar('raw', { sh: "echo 'x'", trim: false })
    expect(out).toBe('x\n')
  })

  test('returns empty on unknown command', async () => {
    const out = await runShellVar('missing', { sh: 'no-such-binary-zxqj' })
    expect(out).toBe('')
  })
})
