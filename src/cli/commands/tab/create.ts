import { resolve as resolvePath } from 'node:path'

import type { CliCommand } from '../../registry'

import {
  IPC_CAPABILITY_CREATE_TAB_SIZE_FALLBACK,
  IPC_CAPABILITY_THIN_ATTACH,
} from '../../../ipc/protocol'
import { createPrefixedId } from '../../../platform/id'
import { getAllAssistantOptions, parseCommand } from '../../../pty/command-registry'
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
    const command =
      typeof ctx.args.flags.command === 'string' ? ctx.args.flags.command : option.command
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

    const { args, executable } = parseCommand(command)
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

    writeJson({ assistant: assistantId, command, tabId, title, worktreeId })
    return EXIT_OK
  },
  summary: 'Create a new tab in the active workspace',
  verb: 'create',
}
