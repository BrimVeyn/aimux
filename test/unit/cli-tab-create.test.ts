import { describe, expect, test } from 'bun:test'
import { resolve as resolvePath } from 'node:path'

import { resolveAssistantCommand, resolveTabCwd } from '../../src/cli/commands/tab/create'
import {
  buildAssistantModelArgs,
  getAllAssistantOptions,
  parseCommand,
} from '../../src/pty/command-registry'

function assistant(id: string, custom: Record<string, string> = {}) {
  const option = getAllAssistantOptions(custom).find((o) => o.id === id)
  if (!option) throw new Error(`no assistant ${id}`)
  return option
}

const claude = assistant('claude')

describe('resolveTabCwd', () => {
  test('explicit --cwd wins, resolved to absolute', () => {
    expect(resolveTabCwd('/abs/dir', { path: '/wt/path' })).toBe('/abs/dir')
    expect(resolveTabCwd('rel/dir', undefined)).toBe(resolvePath('rel/dir'))
  })

  test('falls back to the worktree path when --cwd absent', () => {
    expect(resolveTabCwd(undefined, { path: '/wt/path' })).toBe('/wt/path')
  })

  test('both absent → undefined (daemon default)', () => {
    expect(resolveTabCwd(undefined, undefined)).toBeUndefined()
  })
})

describe('resolveAssistantCommand', () => {
  test('customCommands overrides the builtin base', () => {
    const cmd = resolveAssistantCommand(
      undefined,
      { claude: 'claude --dangerously-skip-permissions' },
      claude
    )
    expect(cmd).toBe('claude --dangerously-skip-permissions')
  })

  test('--command override beats customCommands', () => {
    expect(resolveAssistantCommand('claude', { claude: 'claude --yolo' }, claude)).toBe('claude')
  })

  test('unknown key → builtin default', () => {
    expect(resolveAssistantCommand(undefined, {}, claude)).toBe('claude')
  })

  test('purely-custom assistant resolves via getAllAssistantOptions', () => {
    const custom = assistant('my-ai', { 'my-ai': 'my-ai --go' })
    expect(custom.command).toBe('my-ai --go')
    expect(resolveAssistantCommand(undefined, { 'my-ai': 'my-ai --go' }, custom)).toBe('my-ai --go')
  })

  test('customCommands base + --model/--effort append to the assembled argv', () => {
    const command = resolveAssistantCommand(
      undefined,
      { claude: 'claude --dangerously-skip-permissions' },
      claude
    )
    const { args, executable } = parseCommand(command)
    const full = [...args, ...buildAssistantModelArgs(claude, { effort: 'high', model: 'sonnet' })]
    expect(executable).toBe('claude')
    expect(full).toEqual([
      '--dangerously-skip-permissions',
      '--model',
      'sonnet',
      '--effort',
      'high',
    ])
  })
})
