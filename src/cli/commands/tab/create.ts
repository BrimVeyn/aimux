import { resolve as resolvePath } from 'node:path'

import type { WorktreeRecord } from '../../../state/types'
import type { CliContext } from '../../context'
import type { CliCommand } from '../../registry'

import { loadConfig } from '../../../config'
import { removeGitWorktree } from '../../../git/worktree'
import {
  IPC_CAPABILITY_CREATE_TAB_SIZE_FALLBACK,
  IPC_CAPABILITY_LIST_TABS,
  IPC_CAPABILITY_THIN_ATTACH,
  IPC_CAPABILITY_WORKER_METADATA,
} from '../../../ipc/protocol'
import { createPrefixedId } from '../../../platform/id'
import { pruneEmptyWorktreeParent } from '../../../platform/worktree-paths'
import {
  type AssistantOption,
  buildAssistantModelArgs,
  getAllAssistantOptions,
  parseCommand,
} from '../../../pty/command-registry'
import { CliUsageError, SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'
import { createProjectWorktree } from '../worktree/create-core'

const FALLBACK_COLS = 200
const FALLBACK_ROWS = 60

export interface CreateCliTabOptions {
  assistantId: string
  base?: string
  branch?: string
  commandOverride?: string
  cwd?: string
  effort?: string
  model?: string
  newWorktree?: boolean | string
  title?: string
  workerName?: string
  worktreeId?: string
}

export interface CreateCliTabResult {
  assistant: string
  branch: string | null
  command: string
  cwd: string | null
  effort: string | null
  model: string | null
  name: string | null
  path: string | null
  tabId: string
  title: string
  workerName: string | null
  worktreeId: string | null
}

/**
 * Resolve the cwd a spawned tab should run in. Precedence: explicit `--cwd`
 * (resolved to absolute) > the resolved worktree's path > undefined (the
 * daemon's default). Worktree record paths are already absolute.
 */
export function resolveTabCwd(
  cwdFlag: string | undefined,
  worktreeRecord: { path: string } | undefined
): string | undefined {
  if (cwdFlag !== undefined) return resolvePath(cwdFlag)
  return worktreeRecord?.path
}

/**
 * Resolve the base command a tab launches. Mirrors the UI's precedence
 * (`src/app-runtime/side-effects.ts`): an explicit `--command` override wins,
 * else the project's persisted `customCommands[assistantId]` (so CLI workers
 * inherit e.g. `claude --dangerously-skip-permissions`), else the builtin
 * default. `getAllAssistantOptions` deliberately does NOT apply builtin
 * overrides, so this lookup must be explicit.
 */
export function resolveAssistantCommand(
  commandOverride: string | undefined,
  customCommands: Record<string, string>,
  option: AssistantOption
): string {
  return commandOverride ?? customCommands[option.id] ?? option.command
}

async function rollbackCreatedWorktree(
  record: WorktreeRecord,
  ctx: CliContext,
  originalError: unknown
): Promise<never> {
  const daemon = await ctx.getDaemon()
  const project = ctx.getProject()
  let rollbackError: unknown
  try {
    await removeGitWorktree({
      force: true,
      repoPath: record.repoRoot,
      targetPath: record.path,
    })
    await pruneEmptyWorktreeParent(record.path)
    await daemon.expectOk('removeWorktreeRecord', {
      projectId: project.id,
      worktreeId: record.id,
    })
  } catch (error) {
    rollbackError = error
  }
  const original = originalError instanceof Error ? originalError.message : String(originalError)
  if (rollbackError === undefined) throw originalError
  const rollback =
    rollbackError instanceof Error ? rollbackError.message : JSON.stringify(rollbackError)
  throw new Error(`${original}; rollback failed: ${rollback}`)
}

/**
 * Create a tab without writing to stdout. Worker commands compose this helper
 * with prompt dispatch/await while `tab create` remains a thin compatibility
 * adapter. All validation and daemon attachment happen before a worktree is
 * created; any later failure rolls the fresh worktree back.
 */
export async function createCliTab(
  ctx: CliContext,
  options: CreateCliTabOptions
): Promise<CreateCliTabResult> {
  const {
    assistantId,
    base,
    branch,
    commandOverride,
    cwd: cwdRaw,
    effort,
    model,
    newWorktree,
    title: requestedTitle,
    workerName,
    worktreeId: requestedWorktreeId,
  } = options
  if (assistantId.length === 0) throw new CliUsageError('--assistant is required')
  if (workerName !== undefined && workerName.trim().length === 0) {
    throw new CliUsageError('--name must be a non-empty string')
  }
  if (commandOverride !== undefined && (model !== undefined || effort !== undefined)) {
    throw new CliUsageError(
      '--model / --effort cannot be combined with --command (bake them into --command)'
    )
  }

  const createFreshWorktree = newWorktree !== undefined && newWorktree !== false
  if (createFreshWorktree && requestedWorktreeId !== undefined) {
    throw new CliUsageError(
      '--new-worktree creates its own; use --worktree <id> to co-locate instead'
    )
  }
  if (createFreshWorktree && cwdRaw !== undefined) {
    throw new CliUsageError('--new-worktree sets the cwd to the new worktree; drop --cwd')
  }
  if (!createFreshWorktree && (base !== undefined || branch !== undefined)) {
    throw new CliUsageError(
      '--base / --branch require --new-worktree (use `worktree create` otherwise)'
    )
  }

  // Resolve and validate the complete assistant invocation before touching git.
  const { customCommands } = loadConfig()
  const option = getAllAssistantOptions(customCommands).find((entry) => entry.id === assistantId)
  if (!option) {
    const known = getAllAssistantOptions(customCommands)
      .map((entry) => entry.id)
      .join(', ')
    throw new CliUsageError(`unknown assistant: ${assistantId} (known: ${known})`)
  }
  const command = resolveAssistantCommand(commandOverride, customCommands, option)
  const { args: baseArgs, executable } = parseCommand(command)
  const args = [...baseArgs, ...buildAssistantModelArgs(option, { effort, model })]
  const title = requestedTitle ?? option.label
  const tabId = createPrefixedId('tab')

  const project = ctx.getProject()
  const daemon = await ctx.getDaemon()
  if (!daemon.hasCapability(IPC_CAPABILITY_THIN_ATTACH)) {
    throw new Error(
      'daemon predates thinAttach capability — restart aimux to pick up the new daemon'
    )
  }
  if (workerName !== undefined && !daemon.hasCapability(IPC_CAPABILITY_WORKER_METADATA)) {
    throw new Error(
      'daemon predates workerMetadata capability — restart aimux to use worker commands'
    )
  }
  if (workerName !== undefined) {
    if (!daemon.hasCapability(IPC_CAPABILITY_LIST_TABS)) {
      throw new Error('daemon cannot validate worker-name uniqueness — restart aimux')
    }
    const existing = await daemon.listTabs(project.id)
    if (existing.tabs.some((tab) => tab.workerName === workerName)) {
      throw new Error(`worker name already exists in project "${project.name}": ${workerName}`)
    }
  }

  // Attach before creating a worktree so stale daemon/project failures have no
  // git-side effect.
  await daemon.attach({ cols: 0, projectId: project.id, rows: 0, thin: true })

  let worktreeId = requestedWorktreeId ?? project.activeWorktreeId
  let worktreeRecord =
    worktreeId !== undefined
      ? project.worktrees?.find((entry) => entry.id === worktreeId)
      : undefined
  if (requestedWorktreeId !== undefined && worktreeRecord === undefined) {
    const ids = project.worktrees?.map((entry) => entry.id).join(', ') ?? '(none)'
    throw new Error(`unknown worktree id: ${requestedWorktreeId} (known: ${ids})`)
  }

  let createdWorktree: WorktreeRecord | undefined
  if (createFreshWorktree) {
    const worktreeName =
      typeof newWorktree === 'string' && newWorktree !== ''
        ? newWorktree
        : `${assistantId}-${tabId.slice(-6)}`
    createdWorktree = await createProjectWorktree({
      base: base ?? 'HEAD',
      branch: branch ?? `aimux/${worktreeName}`,
      daemon,
      name: worktreeName,
      project,
    })
    worktreeId = createdWorktree.id
    worktreeRecord = createdWorktree
  }

  const cwd = resolveTabCwd(cwdRaw, worktreeRecord)
  const useFallback = daemon.hasCapability(IPC_CAPABILITY_CREATE_TAB_SIZE_FALLBACK)
  try {
    await daemon.expectOk('createTab', {
      args,
      assistant: assistantId,
      autoRenameCandidate: requestedTitle === undefined,
      cols: useFallback ? 0 : FALLBACK_COLS,
      command: executable,
      cwd,
      rows: useFallback ? 0 : FALLBACK_ROWS,
      tabId,
      title,
      workerName,
      worktreeId,
    })
  } catch (error) {
    if (createdWorktree !== undefined) {
      return rollbackCreatedWorktree(createdWorktree, ctx, error)
    }
    throw error
  }

  return {
    assistant: assistantId,
    branch: worktreeRecord?.branch ?? null,
    command: [executable, ...args].join(' '),
    cwd: cwd ?? null,
    effort: effort ?? null,
    model: model ?? null,
    name: worktreeRecord?.name ?? null,
    path: worktreeRecord?.path ?? null,
    tabId,
    title,
    workerName: workerName ?? null,
    worktreeId: worktreeId ?? null,
  }
}

export const tabCreate: CliCommand = {
  args: [],
  flags: [
    ...SHARED_FLAGS,
    {
      complete: { kind: 'dynamic', source: 'assistant' },
      description: 'assistant id (claude, codex, opencode, grok, kimi, terminal, ...)',
      kind: 'string',
      name: 'assistant',
    },
    {
      complete: { kind: 'none' },
      description: 'tab title (defaults to assistant label)',
      kind: 'string',
      name: 'title',
    },
    {
      complete: { kind: 'file' },
      description: 'cwd for the spawned PTY',
      kind: 'string',
      name: 'cwd',
    },
    {
      complete: { kind: 'none' },
      description: 'explicit command (overrides the assistant default)',
      kind: 'string',
      name: 'command',
    },
    {
      complete: { kind: 'none' },
      description: 'model for the worker (maps to the assistant’s model flag)',
      kind: 'string',
      name: 'model',
    },
    {
      complete: { kind: 'none' },
      description: 'reasoning-effort level (maps to the assistant’s effort flag)',
      kind: 'string',
      name: 'effort',
    },
    {
      complete: { kind: 'dynamic', source: 'worktree' },
      description: 'worktree id the tab belongs to (defaults to the project’s active worktree)',
      kind: 'string',
      name: 'worktree',
    },
    {
      complete: { kind: 'none' },
      description: 'create a fresh worktree for this tab (optionally named: --new-worktree=<name>)',
      kind: 'optional-string',
      name: 'new-worktree',
    },
    {
      complete: { kind: 'dynamic', source: 'git-ref' },
      description: 'base ref for --new-worktree (default HEAD)',
      kind: 'string',
      name: 'base',
    },
    {
      complete: { kind: 'none' },
      description: 'branch for --new-worktree (default aimux/<name>)',
      kind: 'string',
      name: 'branch',
    },
  ],
  group: 'tab',
  run: async (ctx) => {
    const assistantId = ctx.args.flags.assistant
    if (typeof assistantId !== 'string' || assistantId.length === 0) {
      throw new CliUsageError('--assistant is required')
    }
    const commandOverride =
      typeof ctx.args.flags.command === 'string' ? ctx.args.flags.command : undefined
    const model = typeof ctx.args.flags.model === 'string' ? ctx.args.flags.model : undefined
    const effort = typeof ctx.args.flags.effort === 'string' ? ctx.args.flags.effort : undefined

    const title = typeof ctx.args.flags.title === 'string' ? ctx.args.flags.title : undefined
    const cwdRaw = typeof ctx.args.flags.cwd === 'string' ? ctx.args.flags.cwd : undefined
    const newWorktreeRaw = ctx.args.flags['new-worktree']
    const newWorktreeFlag =
      typeof newWorktreeRaw === 'string' || typeof newWorktreeRaw === 'boolean'
        ? newWorktreeRaw
        : undefined
    const worktreeFlag =
      typeof ctx.args.flags.worktree === 'string' ? ctx.args.flags.worktree : undefined
    const baseFlag = typeof ctx.args.flags.base === 'string' ? ctx.args.flags.base : undefined
    const branchFlag = typeof ctx.args.flags.branch === 'string' ? ctx.args.flags.branch : undefined
    const result = await createCliTab(ctx, {
      assistantId,
      base: baseFlag,
      branch: branchFlag,
      commandOverride,
      cwd: cwdRaw,
      effort,
      model,
      newWorktree: newWorktreeFlag,
      title,
      worktreeId: worktreeFlag,
    })
    writeJson(result)
    return EXIT_OK
  },
  summary: 'Create a new tab in the active project',
  verb: 'create',
}
