import type { CliCommand } from '../../registry'

import { SHARED_FLAGS } from '../../flags'
import { writeJson } from '../../output'
import { DEFAULT_TIMEOUT_MS } from '../tab/await-turn'
import {
  awaitExistingWorker,
  resolveWorkerTab,
  workerEnvelope,
  workerOutcomeExitCode,
  workerView,
} from './shared'

export const workerAwait: CliCommand = {
  args: [{ name: 'worker', required: true }],
  flags: [
    ...SHARED_FLAGS,
    { description: 'overall turn cap in milliseconds', kind: 'number', name: 'timeout' },
  ],
  group: 'worker',
  run: async (ctx) => {
    const tab = await resolveWorkerTab(ctx, ctx.args.positionals[0] ?? '')
    const outcome = await awaitExistingWorker(
      ctx,
      tab.id,
      typeof ctx.args.flags.timeout === 'number' ? ctx.args.flags.timeout : DEFAULT_TIMEOUT_MS
    )
    writeJson(workerEnvelope(workerView(ctx, tab), outcome))
    return workerOutcomeExitCode(outcome)
  },
  summary: "Await an existing worker's in-flight turn",
  verb: 'await',
}
