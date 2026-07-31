import type { CliCommand } from '../../registry'

import { IPC_CAPABILITY_PROJECT_LIFECYCLE } from '../../../ipc/protocol'
import { resolveProject } from '../../client/project-resolver'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, EXIT_TIMEOUT, writeJson } from '../../output'

const DEFAULT_WAIT_TIMEOUT_MS = 30_000

export const projectSwitch: CliCommand = {
  args: [{ complete: { kind: 'dynamic', source: 'project' }, name: 'project', required: true }],
  flags: [
    ...SHARED_FLAGS,
    {
      description: 'wait until the UI (or daemon) confirms the switch completed',
      kind: 'boolean',
      name: 'wait',
    },
    {
      description: 'timeout for --wait, in milliseconds (default 30000)',
      kind: 'number',
      name: 'timeout',
    },
  ],
  group: 'project',
  run: async (ctx) => {
    const target = ctx.args.positionals[0]
    if (typeof target !== 'string' || target.length === 0) {
      throw new Error('target project is required (id or name)')
    }
    const project = resolveProject(target)
    const wait = ctx.args.flags.wait === true
    const timeoutMs =
      typeof ctx.args.flags.timeout === 'number' ? ctx.args.flags.timeout : DEFAULT_WAIT_TIMEOUT_MS

    const daemon = await ctx.getDaemon()
    if (!daemon.hasCapability(IPC_CAPABILITY_PROJECT_LIFECYCLE)) {
      throw new Error(
        'daemon predates projectLifecycle capability — restart aimux to pick up the new daemon'
      )
    }

    if (!wait) {
      await daemon.expectOk('switchProject', { targetProjectId: project.id })
      writeJson({ name: project.name, targetProjectId: project.id })
      return EXIT_OK
    }

    // Subscribe BEFORE sending the request so we don't miss the broadcast for
    // the no-UI path (the daemon emits `projectSwitched` synchronously in
    // that branch).
    const settled = new Promise<number>((resolve) => {
      const off = daemon.on('projectSwitched', (payload) => {
        if (payload.projectId !== project.id) return
        off()
        clearTimeout(timer)
        writeJson({ name: project.name, targetProjectId: project.id })
        resolve(EXIT_OK)
      })
      const timer = setTimeout(() => {
        off()
        writeJson({
          error: 'timed out waiting for projectSwitched',
          targetProjectId: project.id,
        })
        resolve(EXIT_TIMEOUT)
      }, timeoutMs)
    })

    await daemon.expectOk('switchProject', { targetProjectId: project.id })
    return settled
  },
  summary: 'Switch the UI (or catalog when headless) to another project',
  verb: 'switch',
}
