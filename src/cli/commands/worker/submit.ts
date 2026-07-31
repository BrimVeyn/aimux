import type { CliCommand } from '../../registry'

import { SHARED_FLAGS } from '../../flags'
import { writeJson } from '../../output'
import {
  DETACH_UPTAKE_TIMEOUT_MS,
  resolveWorkerTarget,
  submitWorkerPrompt,
  workerEnvelope,
  workerOutcomeExitCode,
  workerView,
} from './shared'

export const workerSubmit: CliCommand = {
  args: [{ complete: { kind: 'dynamic', source: 'worker' }, name: 'worker', required: true }],
  flags: [
    ...SHARED_FLAGS,
    {
      description: 'milliseconds to wait for the submit→working confirmation (default 15000)',
      kind: 'number',
      name: 'uptake-timeout',
    },
  ],
  group: 'worker',
  run: async (ctx) => {
    const { project, tab } = await resolveWorkerTarget(ctx, ctx.args.positionals[0] ?? '')
    const outcome = await submitWorkerPrompt(
      ctx,
      project,
      tab.id,
      typeof ctx.args.flags['uptake-timeout'] === 'number'
        ? ctx.args.flags['uptake-timeout']
        : DETACH_UPTAKE_TIMEOUT_MS
    )
    writeJson(workerEnvelope(project, workerView(project, tab), outcome))
    return workerOutcomeExitCode(outcome)
  },
  summary: 'Submit a prompt already sitting in a worker composer and confirm uptake',
  verb: 'submit',
}
