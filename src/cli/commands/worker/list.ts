import type { CliCommand } from '../../registry'

import { projectIdentity } from '../../client/project-resolver'
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
      description: 'list workers in every catalogued project, not just the target one',
      kind: 'boolean',
      name: 'all-projects',
    },
  ],
  group: 'worker',
  run: async (ctx) => {
    const selector = ctx.args.positionals[0]

    // `{"workers":[]}` alone is indistinguishable from "every worker died", and
    // the natural recovery from that reading is a destructive re-dispatch. Name
    // the project that was queried so an empty fleet is legible as "not here"
    // rather than "gone", and offer one call that answers "are they really gone?"
    if (ctx.args.flags['all-projects'] === true) {
      const targets = await listWorkerTargets(ctx)
      writeJson({
        schemaVersion: WORKER_SCHEMA_VERSION,
        workers: targets
          .filter((target) => selector === undefined || target.tab.workerName === selector)
          .map((target) => ({
            ...workerView(target.project, target.tab),
            project: projectIdentity(target.project),
          })),
      })
      return EXIT_OK
    }

    if (selector !== undefined) {
      const { project, tab } = await resolveWorkerTarget(ctx, selector)
      writeJson({
        project: projectIdentity(project),
        schemaVersion: WORKER_SCHEMA_VERSION,
        workers: [workerView(project, tab)],
      })
      return EXIT_OK
    }

    const project = ctx.getProject()
    const tabs = await listNamedWorkerTabs(ctx, project)
    writeJson({
      project: projectIdentity(project),
      schemaVersion: WORKER_SCHEMA_VERSION,
      workers: tabs.map((tab) => workerView(project, tab)),
    })
    return EXIT_OK
  },
  summary: 'List named workers with liveness and worktree context',
  verb: 'list',
}
