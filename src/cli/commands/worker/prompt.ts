import type { CliCommand } from '../../registry'

import { SHARED_FLAGS } from '../../flags'
import { writeJson } from '../../output'
import { DEFAULT_TIMEOUT_MS } from '../tab/await-turn'
import { resolvePromptText } from '../tab/prompt-io'
import {
  dispatchWorkerPrompt,
  resolveWorkerTarget,
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
    {
      description:
        'milliseconds to wait for the detached submit→working confirmation (default 15000)',
      kind: 'number',
      name: 'uptake-timeout',
    },
    {
      description:
        'clear the composer (<C-u>) before writing, so text typed by a human in the UI cannot be concatenated onto this prompt',
      kind: 'boolean',
      name: 'replace',
    },
  ],
  group: 'worker',
  run: async (ctx) => {
    const selector = ctx.args.positionals[0] ?? ''
    const { tab, workspace } = await resolveWorkerTarget(ctx, selector)
    const promptFile =
      typeof ctx.args.flags['prompt-file'] === 'string' ? ctx.args.flags['prompt-file'] : undefined
    const text = await resolvePromptText(
      promptFile,
      ctx.args.flags.stdin === true,
      ctx.args.positionals[1]
    )
    const outcome = await dispatchWorkerPrompt(ctx, workspace, tab.id, text, {
      detach: ctx.args.flags.detach === true,
      replace: ctx.args.flags.replace === true,
      timeoutMs:
        typeof ctx.args.flags.timeout === 'number' ? ctx.args.flags.timeout : DEFAULT_TIMEOUT_MS,
      uptakeTimeoutMs:
        typeof ctx.args.flags['uptake-timeout'] === 'number'
          ? ctx.args.flags['uptake-timeout']
          : undefined,
    })
    writeJson(workerEnvelope(workspace, workerView(workspace, tab), outcome))
    return workerOutcomeExitCode(outcome)
  },
  summary: 'Prompt an existing named worker and await its outcome',
  verb: 'prompt',
}
