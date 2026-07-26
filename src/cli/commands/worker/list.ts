import type { CliCommand } from '../../registry'

import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'
import { listNamedWorkerTabs, resolveWorkerTab, WORKER_SCHEMA_VERSION, workerView } from './shared'

export const workerList: CliCommand = {
  args: [{ complete: { kind: 'dynamic', source: 'worker' }, name: 'worker' }],
  flags: SHARED_FLAGS,
  group: 'worker',
  run: async (ctx) => {
    const selector = ctx.args.positionals[0]
    const tabs =
      selector === undefined
        ? await listNamedWorkerTabs(ctx)
        : [await resolveWorkerTab(ctx, selector)]
    writeJson({
      schemaVersion: WORKER_SCHEMA_VERSION,
      workers: tabs.map((tab) => workerView(ctx, tab)),
    })
    return EXIT_OK
  },
  summary: 'List named workers with liveness and worktree context',
  verb: 'list',
}
