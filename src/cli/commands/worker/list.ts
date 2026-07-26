import type { CliCommand } from '../../registry'

import { workspaceIdentity } from '../../client/workspace-resolver'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'
import {
  listNamedWorkerTabs,
  listWorkerTargets,
  resolveWorkerTarget,
  WORKER_SCHEMA_VERSION,
  workerView,
} from './shared'

export const workerList: CliCommand = {
  args: [{ complete: { kind: 'dynamic', source: 'worker' }, name: 'worker' }],
  flags: [
    ...SHARED_FLAGS,
    {
      description: 'list workers in every catalogued workspace, not just the target one',
      kind: 'boolean',
      name: 'all-workspaces',
    },
  ],
  group: 'worker',
  run: async (ctx) => {
    const selector = ctx.args.positionals[0]

    // `{"workers":[]}` alone is indistinguishable from "every worker died", and
    // the natural recovery from that reading is a destructive re-dispatch. Name
    // the workspace that was queried so an empty fleet is legible as "not here"
    // rather than "gone", and offer one call that answers "are they really gone?"
    if (ctx.args.flags['all-workspaces'] === true) {
      const targets = await listWorkerTargets(ctx)
      writeJson({
        schemaVersion: WORKER_SCHEMA_VERSION,
        workers: targets
          .filter((target) => selector === undefined || target.tab.workerName === selector)
          .map((target) => ({
            ...workerView(target.workspace, target.tab),
            workspace: workspaceIdentity(target.workspace),
          })),
      })
      return EXIT_OK
    }

    if (selector !== undefined) {
      const { tab, workspace } = await resolveWorkerTarget(ctx, selector)
      writeJson({
        schemaVersion: WORKER_SCHEMA_VERSION,
        workers: [workerView(workspace, tab)],
        workspace: workspaceIdentity(workspace),
      })
      return EXIT_OK
    }

    const workspace = ctx.getWorkspace()
    const tabs = await listNamedWorkerTabs(ctx, workspace)
    writeJson({
      schemaVersion: WORKER_SCHEMA_VERSION,
      workers: tabs.map((tab) => workerView(workspace, tab)),
      workspace: workspaceIdentity(workspace),
    })
    return EXIT_OK
  },
  summary: 'List named workers with liveness and worktree context',
  verb: 'list',
}
