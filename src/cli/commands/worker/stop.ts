import type { CliCommand } from '../../registry'

import { isGitWorktreeDirty, removeGitWorktree } from '../../../git/worktree'
import {
  IPC_CAPABILITY_THIN_ATTACH,
  IPC_CAPABILITY_WORKSPACE_LIFECYCLE_EVENTS,
} from '../../../ipc/protocol'
import { pruneEmptyWorktreeParent } from '../../../platform/worktree-paths'
import { projectIdentity } from '../../client/project-resolver'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, EXIT_RUNTIME, writeJson } from '../../output'
import { resolveWorkerTarget, WORKER_SCHEMA_VERSION, workerView } from './shared'

export const workerStop: CliCommand = {
  args: [{ complete: { kind: 'dynamic', source: 'worker' }, name: 'worker', required: true }],
  flags: [
    ...SHARED_FLAGS,
    {
      description: 'remove its aimux-created workspace after closing the tab',
      kind: 'boolean',
      name: 'cleanup-workspace',
    },
    { description: 'force removal of a dirty workspace', kind: 'boolean', name: 'force' },
  ],
  group: 'worker',
  run: async (ctx) => {
    const { project, tab } = await resolveWorkerTarget(ctx, ctx.args.positionals[0] ?? '')
    const worker = workerView(project, tab)
    const daemon = await ctx.getDaemon()
    const cleanup = ctx.args.flags['cleanup-workspace'] === true
    const record =
      tab.workspaceId === undefined
        ? undefined
        : project.workspaces?.find((workspace) => workspace.id === tab.workspaceId)

    if (cleanup) {
      if (record === undefined) throw new Error('worker has no registered workspace to clean up')
      if (record.source !== 'aimux-temp' || !record.createdByAimux) {
        throw new Error('refusing to clean up a primary or externally managed workspace')
      }
      const siblings = (await daemon.listTabs(project.id)).tabs.filter(
        (entry) => entry.id !== tab.id && entry.workspaceId === record.id
      )
      if (siblings.length > 0) {
        throw new Error(
          `refusing to clean up shared workspace; live tabs: ${siblings.map((entry) => entry.id).join(', ')}`
        )
      }
      if (!daemon.hasCapability(IPC_CAPABILITY_WORKSPACE_LIFECYCLE_EVENTS)) {
        throw new Error('daemon predates safe workspace cleanup — restart aimux')
      }
      if (ctx.args.flags.force !== true && (await isGitWorktreeDirty(record.path))) {
        throw new Error('refusing to clean up a dirty workspace without --force')
      }
    }

    // `closeTab` is project-scoped on the daemon, so it fails with "No project
    // attached" unless this connection has attached first. Every other worker
    // verb thin-attaches; this one did not, which made teardown the one step of
    // the documented lifecycle a headless orchestrator could not complete.
    if (!daemon.hasCapability(IPC_CAPABILITY_THIN_ATTACH)) {
      throw new Error(
        'daemon predates thinAttach capability — restart aimux to pick up the new daemon'
      )
    }
    await daemon.attach({ cols: 0, projectId: project.id, rows: 0, thin: true })

    // Teardown is two independent effects. Report them independently: a failed
    // tab close must not strand a merged workspace on disk with no way to remove
    // it through aimux (the alternative — a bare `git worktree remove` — desyncs
    // the catalog from disk).
    let closeError: string | undefined
    try {
      await daemon.expectOk('closeTab', { tabId: tab.id })
    } catch (error) {
      closeError = error instanceof Error ? error.message : String(error)
      if (!cleanup) throw error
    }

    let workspaceRemoved = false
    if (cleanup && record !== undefined) {
      await removeGitWorktree({
        force: ctx.args.flags.force === true,
        repoPath: record.repoRoot,
        targetPath: record.path,
      })
      await pruneEmptyWorktreeParent(record.path)
      try {
        await daemon.expectOk('removeWorkspaceRecord', {
          projectId: project.id,
          workspaceId: record.id,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(
          `worker stopped and git worktree removed, but catalog reconciliation failed: ${message}`
        )
      }
      workspaceRemoved = true
    }
    writeJson({
      closed: closeError === undefined,
      ...(closeError === undefined ? {} : { closeError }),
      project: projectIdentity(project),
      schemaVersion: WORKER_SCHEMA_VERSION,
      worker,
      workspaceRemoved,
    })
    return closeError === undefined ? EXIT_OK : EXIT_RUNTIME
  },
  summary: 'Stop a named worker and optionally clean up its workspace',
  verb: 'stop',
}
