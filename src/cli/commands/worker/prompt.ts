import type { CliCommand } from '../../registry'

import { SHARED_FLAGS } from '../../flags'
import { writeJson } from '../../output'
import { DEFAULT_TIMEOUT_MS } from '../tab/await-turn'
import { resolvePromptText } from '../tab/prompt-io'
import {
  dispatchWorkerPrompt,
  resolveWorkerTab,
  workerEnvelope,
  workerOutcomeExitCode,
  workerView,
} from './shared'

export const workerPrompt: CliCommand = {
  args: [
    { complete: { kind: 'dynamic', source: 'worker' }, name: 'worker', required: true },
    { complete: { kind: 'none' }, name: 'text' },
  ],
  flags: [
    ...SHARED_FLAGS,
    {
      complete: { kind: 'file' },
      description: 'read the prompt from this file',
      kind: 'string',
      name: 'prompt-file',
    },
    { description: 'read the prompt from stdin', kind: 'boolean', name: 'stdin' },
    {
      description: 'return after prompt uptake instead of turn completion',
      kind: 'boolean',
      name: 'detach',
    },
    { description: 'overall turn cap in milliseconds', kind: 'number', name: 'timeout' },
  ],
  group: 'worker',
  run: async (ctx) => {
    const selector = ctx.args.positionals[0] ?? ''
    const tab = await resolveWorkerTab(ctx, selector)
    const promptFile =
      typeof ctx.args.flags['prompt-file'] === 'string' ? ctx.args.flags['prompt-file'] : undefined
    const text = await resolvePromptText(
      promptFile,
      ctx.args.flags.stdin === true,
      ctx.args.positionals[1]
    )
    const outcome = await dispatchWorkerPrompt(ctx, tab.id, text, {
      detach: ctx.args.flags.detach === true,
      timeoutMs:
        typeof ctx.args.flags.timeout === 'number' ? ctx.args.flags.timeout : DEFAULT_TIMEOUT_MS,
    })
    writeJson(workerEnvelope(workerView(ctx, tab), outcome))
    return workerOutcomeExitCode(outcome)
  },
  summary: 'Prompt an existing named worker and await its outcome',
  verb: 'prompt',
}
