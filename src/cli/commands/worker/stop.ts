import type { CliCommand } from '../../registry'

import { isGitWorktreeDirty, removeGitWorktree } from '../../../git/worktree'
import { IPC_CAPABILITY_WORKTREE_LIFECYCLE_EVENTS } from '../../../ipc/protocol'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'
import { resolveWorkerTab, WORKER_SCHEMA_VERSION, workerView } from './shared'

export const workerStop: CliCommand = {
  args: [{ name: 'worker', required: true }],
  flags: [
    ...SHARED_FLAGS,
    {
      description: 'remove its aimux-created worktree after closing the tab',
      kind: 'boolean',
      name: 'cleanup-worktree',
    },
    { description: 'force removal of a dirty worktree', kind: 'boolean', name: 'force' },
  ],
  group: 'worker',
  run: async (ctx) => {
    const tab = await resolveWorkerTab(ctx, ctx.args.positionals[0] ?? '')
    const worker = workerView(ctx, tab)
    const daemon = await ctx.getDaemon()
    const workspace = ctx.getWorkspace()
    const cleanup = ctx.args.flags['cleanup-worktree'] === true
    const record =
      tab.worktreeId === undefined
        ? undefined
        : workspace.worktrees?.find((worktree) => worktree.id === tab.worktreeId)

    if (cleanup) {
      if (record === undefined) throw new Error('worker has no registered worktree to clean up')
      if (record.source !== 'aimux-temp' || !record.createdByAimux) {
        throw new Error('refusing to clean up a primary or externally managed worktree')
      }
      const siblings = (await daemon.listTabs(workspace.id)).tabs.filter(
        (entry) => entry.id !== tab.id && entry.worktreeId === record.id
      )
      if (siblings.length > 0) {
        throw new Error(
          `refusing to clean up shared worktree; live tabs: ${siblings.map((entry) => entry.id).join(', ')}`
        )
      }
      if (!daemon.hasCapability(IPC_CAPABILITY_WORKTREE_LIFECYCLE_EVENTS)) {
        throw new Error('daemon predates safe worktree cleanup — restart aimux')
      }
      if (ctx.args.flags.force !== true && (await isGitWorktreeDirty(record.path))) {
        throw new Error('refusing to clean up a dirty worktree without --force')
      }
    }

    await daemon.expectOk('closeTab', { tabId: tab.id })
    let worktreeRemoved = false
    if (cleanup && record !== undefined) {
      await removeGitWorktree({
        force: ctx.args.flags.force === true,
        repoPath: record.repoRoot,
        targetPath: record.path,
      })
      try {
        await daemon.expectOk('removeWorktreeRecord', {
          sessionId: workspace.id,
          worktreeId: record.id,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(
          `worker stopped and git worktree removed, but catalog reconciliation failed: ${message}`
        )
      }
      worktreeRemoved = true
    }
    writeJson({
      closed: true,
      schemaVersion: WORKER_SCHEMA_VERSION,
      worker,
      worktreeRemoved,
    })
    return EXIT_OK
  },
  summary: 'Stop a named worker and optionally clean up its worktree',
  verb: 'stop',
}
