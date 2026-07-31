import { describe, expect, test } from 'bun:test'
import { resolve as resolvePath } from 'node:path'

import type { DaemonClient } from '../../src/cli/client/daemon-client'
import type { CliContext } from '../../src/cli/context'
import type { ProjectRecord } from '../../src/state/types'

import {
  resolveAssistantCommand,
  resolveTabCwd,
  tabCreate,
} from '../../src/cli/commands/tab/create'
import {
  IPC_CAPABILITY_CREATE_TAB_SIZE_FALLBACK,
  IPC_CAPABILITY_THIN_ATTACH,
} from '../../src/ipc/protocol'
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

// ── tabCreate.run: validation + createTab payload ────────────────────────────

function ctxFor(
  flags: Record<string, string | number | boolean>,
  daemon: DaemonClient,
  workspace: Partial<ProjectRecord> = {}
): CliContext {
  return {
    args: { flags, positionals: [] },
    getDaemon: async () => daemon,
    getWorkspace: () => ({ id: 'ws', name: 'ws', ...workspace }) as unknown as ProjectRecord,
  }
}

const unusedDaemon = {
  attach: async () => ({ tabs: [] }),
  expectOk: async () => {
    throw new Error('should not reach the daemon')
  },
  hasCapability: () => true,
} as unknown as DaemonClient

async function runError(ctx: CliContext): Promise<string> {
  try {
    await tabCreate.run(ctx)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return ''
}

describe('tabCreate --new-worktree validation', () => {
  test('rejects --new-worktree with --worktree', async () => {
    const ctx = ctxFor(
      { 'assistant': 'claude', 'new-worktree': true, 'worktree': 'wt-1' },
      unusedDaemon
    )
    expect(await runError(ctx)).toContain('use --worktree <id> to co-locate')
  })

  test('rejects --new-worktree with --cwd', async () => {
    const ctx = ctxFor({ 'assistant': 'claude', 'cwd': '/tmp', 'new-worktree': true }, unusedDaemon)
    expect(await runError(ctx)).toContain('drop --cwd')
  })

  test('rejects --base without --new-worktree', async () => {
    const ctx = ctxFor({ assistant: 'claude', base: 'main' }, unusedDaemon)
    expect(await runError(ctx)).toContain('require --new-worktree')
  })
})

describe('tabCreate.run createTab payload', () => {
  test('cwd defaults to the active worktree path; worktreeId + args flow through', async () => {
    // Pin an empty profile so loadConfig() finds no customCommands and the test
    // is independent of the machine's real ~/.config/aimux config.
    const prevProfile = process.env.AIMUX_PROFILE
    process.env.AIMUX_PROFILE = `unit-empty-${Date.now()}`
    let captured: Record<string, unknown> = {}
    const daemon = {
      attach: async () => ({ tabs: [] }),
      expectOk: async (type: string, payload: Record<string, unknown>) => {
        if (type === 'createTab') captured = payload
      },
      hasCapability: (n: string) =>
        n === IPC_CAPABILITY_THIN_ATTACH || n === IPC_CAPABILITY_CREATE_TAB_SIZE_FALLBACK,
    } as unknown as DaemonClient

    const ctx = ctxFor({ assistant: 'claude' }, daemon, {
      activeWorktreeId: 'wt-1',
      worktrees: [
        { id: 'wt-1', name: 'x', path: '/repo/wt', source: 'aimux-temp' },
      ] as unknown as ProjectRecord['worktrees'],
    })

    try {
      const { json } = await captureJson(async () => await tabCreate.run(ctx))
      expect(captured.cwd).toBe('/repo/wt')
      expect(captured.worktreeId).toBe('wt-1')
      expect(captured.command).toBe('claude')
      expect(captured.args).toEqual([])
      // Output echoes the resolved worktree placement.
      expect((json as { cwd: string; worktreeId: string }).cwd).toBe('/repo/wt')
      expect((json as { worktreeId: string }).worktreeId).toBe('wt-1')
    } finally {
      if (prevProfile === undefined) delete process.env.AIMUX_PROFILE
      else process.env.AIMUX_PROFILE = prevProfile
    }
  })
})

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
