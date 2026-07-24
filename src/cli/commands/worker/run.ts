import type { CliCommand } from '../../registry'

import { CliUsageError, SHARED_FLAGS } from '../../flags'
import { writeJson } from '../../output'
import { DEFAULT_TIMEOUT_MS } from '../tab/await-turn'
import { createCliTab } from '../tab/create'
import { resolvePromptText } from '../tab/prompt-io'
import {
  dispatchWorkerPrompt,
  validateWorkerName,
  workerEnvelope,
  workerOutcomeExitCode,
  workerView,
} from './shared'

export const workerRun: CliCommand = {
  args: [{ name: 'text' }],
  flags: [
    ...SHARED_FLAGS,
    { description: 'unique workspace-scoped worker name', kind: 'string', name: 'name' },
    {
      description: 'assistant id (claude, codex, opencode, ...)',
      kind: 'string',
      name: 'assistant',
    },
    { description: 'model passed through to the assistant', kind: 'string', name: 'model' },
    {
      description: 'reasoning effort passed through to the assistant',
      kind: 'string',
      name: 'effort',
    },
    { description: 'read the prompt from this file', kind: 'string', name: 'prompt-file' },
    { description: 'read the prompt from stdin', kind: 'boolean', name: 'stdin' },
    {
      description: 'return after prompt uptake instead of turn completion',
      kind: 'boolean',
      name: 'detach',
    },
    { description: 'overall turn cap in milliseconds', kind: 'number', name: 'timeout' },
    { description: 'co-locate in an existing worktree id', kind: 'string', name: 'worktree' },
    {
      description: 'run in the workspace active worktree instead of creating one',
      kind: 'boolean',
      name: 'no-worktree',
    },
    { description: 'base ref for the fresh worktree (default HEAD)', kind: 'string', name: 'base' },
    {
      description: 'branch for the fresh worktree (default aimux/<name>)',
      kind: 'string',
      name: 'branch',
    },
  ],
  group: 'worker',
  run: async (ctx) => {
    const name = typeof ctx.args.flags.name === 'string' ? ctx.args.flags.name : ''
    const assistant = typeof ctx.args.flags.assistant === 'string' ? ctx.args.flags.assistant : ''
    validateWorkerName(name)
    if (assistant === '') throw new CliUsageError('--assistant is required')
    const worktree =
      typeof ctx.args.flags.worktree === 'string' ? ctx.args.flags.worktree : undefined
    const noWorktree = ctx.args.flags['no-worktree'] === true
    if (worktree !== undefined && noWorktree) {
      throw new CliUsageError('--worktree and --no-worktree are mutually exclusive')
    }
    const promptFile =
      typeof ctx.args.flags['prompt-file'] === 'string' ? ctx.args.flags['prompt-file'] : undefined
    const text = await resolvePromptText(
      promptFile,
      ctx.args.flags.stdin === true,
      ctx.args.positionals[0]
    )
    const result = await createCliTab(ctx, {
      assistantId: assistant,
      base: typeof ctx.args.flags.base === 'string' ? ctx.args.flags.base : undefined,
      branch: typeof ctx.args.flags.branch === 'string' ? ctx.args.flags.branch : undefined,
      effort: typeof ctx.args.flags.effort === 'string' ? ctx.args.flags.effort : undefined,
      model: typeof ctx.args.flags.model === 'string' ? ctx.args.flags.model : undefined,
      newWorktree: noWorktree || worktree !== undefined ? undefined : name,
      title: name,
      workerName: name,
      worktreeId: worktree,
    })
    const tabs = await (await ctx.getDaemon()).listTabs(ctx.getWorkspace().id)
    const tab = tabs.tabs.find((entry) => entry.id === result.tabId)
    if (!tab) throw new Error(`created worker disappeared: ${result.tabId}`)
    const worker = workerView(ctx, tab)
    const outcome = await dispatchWorkerPrompt(ctx, result.tabId, text, {
      detach: ctx.args.flags.detach === true,
      timeoutMs:
        typeof ctx.args.flags.timeout === 'number' ? ctx.args.flags.timeout : DEFAULT_TIMEOUT_MS,
    })
    writeJson(workerEnvelope(worker, outcome))
    return workerOutcomeExitCode(outcome)
  },
  summary: 'Create a named worker, dispatch a prompt, and await its outcome',
  verb: 'run',
}
