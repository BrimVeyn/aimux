import { resolve as resolvePath } from 'node:path'

import type { CliCommand } from '../../registry'

import {
  IPC_CAPABILITY_CREATE_TAB_SIZE_FALLBACK,
  IPC_CAPABILITY_THIN_ATTACH,
} from '../../../ipc/protocol'
import { createPrefixedId } from '../../../platform/id'
import {
  buildAssistantModelArgs,
  getAllAssistantOptions,
  parseCommand,
} from '../../../pty/command-registry'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'

const FALLBACK_COLS = 200
const FALLBACK_ROWS = 60

export const tabCreate: CliCommand = {
  args: [],
  flags: [
    ...SHARED_FLAGS,
    {
      description: 'assistant id (claude, codex, opencode, terminal, ...)',
      kind: 'string',
      name: 'assistant',
    },
    { description: 'tab title (defaults to assistant label)', kind: 'string', name: 'title' },
    { description: 'cwd for the spawned PTY', kind: 'string', name: 'cwd' },
    {
      description: 'explicit command (overrides the assistant default)',
      kind: 'string',
      name: 'command',
    },
    {
      description: 'model for the worker (maps to the assistant’s model flag)',
      kind: 'string',
      name: 'model',
    },
    {
      description: 'reasoning-effort level (maps to the assistant’s effort flag)',
      kind: 'string',
      name: 'effort',
    },
    {
      description: 'worktree id the tab belongs to (defaults to the workspace’s active worktree)',
      kind: 'string',
      name: 'worktree',
    },
  ],
  group: 'tab',
  run: async (ctx) => {
    const assistantId = ctx.args.flags.assistant
    if (typeof assistantId !== 'string' || assistantId.length === 0) {
      throw new Error('--assistant is required')
    }
    const options = getAllAssistantOptions({})
    const option = options.find((o) => o.id === assistantId)
    if (!option) {
      throw new Error(
        `unknown assistant: ${assistantId} (known: ${options.map((o) => o.id).join(', ')})`
      )
    }
    const commandOverride =
      typeof ctx.args.flags.command === 'string' ? ctx.args.flags.command : undefined
    const model = typeof ctx.args.flags.model === 'string' ? ctx.args.flags.model : undefined
    const effort = typeof ctx.args.flags.effort === 'string' ? ctx.args.flags.effort : undefined

    // A full `--command` override owns the whole invocation, so `--model` /
    // `--effort` (which only make sense as additions to the assistant default)
    // would be ambiguous alongside it — reject rather than silently drop them.
    if (commandOverride !== undefined && (model !== undefined || effort !== undefined)) {
      throw new Error(
        '--model / --effort cannot be combined with --command (bake them into --command)'
      )
    }

    const command = commandOverride ?? option.command
    const title = typeof ctx.args.flags.title === 'string' ? ctx.args.flags.title : option.label
    const cwdRaw = typeof ctx.args.flags.cwd === 'string' ? ctx.args.flags.cwd : undefined
    const cwd = cwdRaw === undefined ? undefined : resolvePath(cwdRaw)

    const workspace = ctx.getWorkspace()
    const daemon = await ctx.getDaemon()

    if (!daemon.hasCapability(IPC_CAPABILITY_THIN_ATTACH)) {
      throw new Error(
        'daemon predates thinAttach capability — restart aimux to pick up the new daemon'
      )
    }

    // Resolve worktreeId: explicit flag wins, otherwise the workspace's
    // currently-active worktree, otherwise undefined (= no grouping).
    const worktreeFlag =
      typeof ctx.args.flags.worktree === 'string' ? ctx.args.flags.worktree : undefined
    let worktreeId: string | undefined = worktreeFlag ?? workspace.activeWorktreeId
    if (worktreeFlag !== undefined) {
      const known = workspace.worktrees?.some((w) => w.id === worktreeFlag) ?? false
      if (!known) {
        const ids = workspace.worktrees?.map((w) => w.id).join(', ') ?? '(none)'
        throw new Error(`unknown worktree id: ${worktreeFlag} (known: ${ids})`)
      }
      worktreeId = worktreeFlag
    }

    // Thin-attach so we don't clobber the UI's dimensions on the same session.
    await daemon.attach({ cols: 0, rows: 0, sessionId: workspace.id, thin: true })

    const { args: baseArgs, executable } = parseCommand(command)
    // Append the model/effort flags to the assistant default. Throws if the
    // assistant has no control for a requested dimension.
    const modelArgs = buildAssistantModelArgs(option, { effort, model })
    const args = [...baseArgs, ...modelArgs]
    const tabId = createPrefixedId('tab')

    // cols/rows = 0 means "fall back to the session's last attached size" on
    // v11 daemons. Without that capability we have nothing reasonable to put
    // here (the CLI has no terminal of its own), so use a roomy fallback —
    // PTYs are reflowable, so 200×60 won't break anything that adapts.
    const useFallback = daemon.hasCapability(IPC_CAPABILITY_CREATE_TAB_SIZE_FALLBACK)
    await daemon.expectOk('createTab', {
      args,
      assistant: assistantId,
      cols: useFallback ? 0 : FALLBACK_COLS,
      command: executable,
      cwd,
      rows: useFallback ? 0 : FALLBACK_ROWS,
      tabId,
      title,
      worktreeId,
    })

    const resolvedCommand = [executable, ...args].join(' ')
    writeJson({
      assistant: assistantId,
      command: resolvedCommand,
      effort: effort ?? null,
      model: model ?? null,
      tabId,
      title,
      worktreeId,
    })
    return EXIT_OK
  },
  summary: 'Create a new tab in the active workspace',
  verb: 'create',
}
