import type { CliCommand } from '../../registry'

import { IPC_CAPABILITY_PROJECT_LIFECYCLE } from '../../../ipc/protocol'
import { resolveProject } from '../../client/project-resolver'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'

export const projectClose: CliCommand = {
  args: [{ complete: { kind: 'dynamic', source: 'project' }, name: 'project', required: true }],
  flags: SHARED_FLAGS,
  group: 'project',
  run: async (ctx) => {
    const target = ctx.args.positionals[0]
    if (typeof target !== 'string' || target.length === 0) {
      throw new Error('target project is required (id or name)')
    }
    const project = resolveProject(target)

    const daemon = await ctx.getDaemon()
    if (!daemon.hasCapability(IPC_CAPABILITY_PROJECT_LIFECYCLE)) {
      throw new Error(
        'daemon predates projectLifecycle capability — restart aimux to pick up the new daemon'
      )
    }

    await daemon.expectOk('closeProject', { targetProjectId: project.id })
    writeJson({ closedProjectId: project.id, name: project.name })
    return EXIT_OK
  },
  summary: 'Close a project (via the UI when attached, otherwise the catalog)',
  verb: 'close',
}
