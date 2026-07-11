import { describe, expect, test } from 'bun:test'

import { CliUsageError, parseArgs, SHARED_FLAGS } from '../../src/cli/flags'

describe('cli flag parser', () => {
  test('parses --flag value and --flag=value identically', () => {
    const spec = [...SHARED_FLAGS]
    const a = parseArgs(['--workspace', 'main'], spec, [])
    const b = parseArgs(['--workspace=main'], spec, [])
    expect(a.flags.workspace).toBe('main')
    expect(b.flags.workspace).toBe('main')
  })

  test('treats --json as a boolean', () => {
    const parsed = parseArgs(['--json'], SHARED_FLAGS, [])
    expect(parsed.flags.json).toBe(true)
  })

  test('rejects --json=value (booleans take no argument)', () => {
    expect(() => parseArgs(['--json=true'], SHARED_FLAGS, [])).toThrow(CliUsageError)
  })

  test('positionals after -- are not parsed as flags', () => {
    const parsed = parseArgs(['--workspace', 'main', '--', '--workspace'], SHARED_FLAGS, [])
    expect(parsed.flags.workspace).toBe('main')
    expect(parsed.positionals).toEqual(['--workspace'])
  })

  test('unknown flags surface as usage errors', () => {
    expect(() => parseArgs(['--banana'], SHARED_FLAGS, [])).toThrow(/unknown flag: --banana/)
  })

  test('missing required positionals surface as usage errors', () => {
    expect(() => parseArgs([], SHARED_FLAGS, [{ name: 'tabId', required: true }])).toThrow(
      /missing required argument: <tabId>/
    )
  })

  test('numbers are parsed and validated', () => {
    const spec = [{ kind: 'number', name: 'tail' } as const]
    expect(parseArgs(['--tail', '12'], spec, []).flags.tail).toBe(12)
    expect(() => parseArgs(['--tail', 'lots'], spec, [])).toThrow(/must be a number/)
  })

  describe('optional-string kind', () => {
    const spec = [{ kind: 'optional-string', name: 'new-worktree' } as const]

    test('bare flag parses as boolean true', () => {
      expect(parseArgs(['--new-worktree'], spec, []).flags['new-worktree']).toBe(true)
    })

    test('=form binds the value', () => {
      expect(parseArgs(['--new-worktree=fix-auth'], spec, []).flags['new-worktree']).toBe(
        'fix-auth'
      )
    })

    test('=form binds an empty value', () => {
      expect(parseArgs(['--new-worktree='], spec, []).flags['new-worktree']).toBe('')
    })

    test('bare flag does NOT swallow the following positional', () => {
      const parsed = parseArgs(['--new-worktree', 'tab-123'], spec, [{ name: 'tabId' }])
      expect(parsed.flags['new-worktree']).toBe(true)
      expect(parsed.positionals).toEqual(['tab-123'])
    })
  })
})
