import type { WorktreeRecord } from '../../../state/types'
import type { CliContext } from '../../context'

import {
  IPC_CAPABILITY_LIST_TABS,
  IPC_CAPABILITY_QUESTION_EVENTS,
  IPC_CAPABILITY_THIN_ATTACH,
  IPC_CAPABILITY_TURN_LIFECYCLE,
  IPC_CAPABILITY_WORKER_METADATA,
  type TabSessionSummary,
} from '../../../ipc/protocol'
import { CliUsageError } from '../../flags'
import { EXIT_OK, EXIT_QUESTION, EXIT_RUNTIME, EXIT_TIMEOUT } from '../../output'
import { snapshotTailLines } from '../../snapshot-render'
import { awaitTurn, type TurnOutcome } from '../tab/await-turn'
import { buildPromptPayload, writePromptPayload } from '../tab/prompt-io'

export const WORKER_SCHEMA_VERSION = 1
export const WORKER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const QUESTION_TAIL_LINES = 25
const DETACH_UPTAKE_TIMEOUT_MS = 15_000

export interface WorkerView {
  activity?: TabSessionSummary['activity']
  assistant: string
  branch: string | null
  command: string
  lastLine?: string
  name: string
  path: string | null
  status: TabSessionSummary['status']
  tabId: string
  title: string
  worktreeId: string | null
}

export interface WorkerOutcome {
  durationMs: number
  error?: string
  kind?: string
  options?: string[]
  question?: string
  status: 'completed' | 'dispatched' | 'question' | 'timeout' | 'error'
  uptake?: { confirmed: boolean; ms?: number }
}

export function validateWorkerName(name: string): void {
  if (!WORKER_NAME_PATTERN.test(name)) {
    throw new CliUsageError(
      'worker name must be 1-64 characters: letters, numbers, dot, underscore, or hyphen'
    )
  }
}

function worktreeFor(ctx: CliContext, worktreeId: string | undefined): WorktreeRecord | undefined {
  if (worktreeId === undefined) return undefined
  return ctx.getWorkspace().worktrees?.find((worktree) => worktree.id === worktreeId)
}

export function workerView(ctx: CliContext, tab: TabSessionSummary): WorkerView {
  if (tab.workerName === undefined) {
    throw new Error(`tab is not a named worker: ${tab.id}`)
  }
  const worktree = worktreeFor(ctx, tab.worktreeId)
  return {
    activity: tab.activity,
    assistant: tab.assistant,
    branch: worktree?.branch ?? null,
    command: tab.command,
    lastLine: tab.lastLine,
    name: tab.workerName,
    path: worktree?.path ?? null,
    status: tab.status,
    tabId: tab.id,
    title: tab.title,
    worktreeId: tab.worktreeId ?? null,
  }
}

export async function listNamedWorkerTabs(ctx: CliContext): Promise<TabSessionSummary[]> {
  const daemon = await ctx.getDaemon()
  if (
    !daemon.hasCapability(IPC_CAPABILITY_LIST_TABS) ||
    !daemon.hasCapability(IPC_CAPABILITY_WORKER_METADATA)
  ) {
    throw new Error('daemon predates worker commands — restart aimux')
  }
  return (await daemon.listTabs(ctx.getWorkspace().id)).tabs.filter(
    (tab) => tab.workerName !== undefined
  )
}

export async function resolveWorkerTab(
  ctx: CliContext,
  selector: string
): Promise<TabSessionSummary> {
  const workers = await listNamedWorkerTabs(ctx)
  const byId = workers.find((tab) => tab.id === selector)
  if (byId) return byId
  const matches = workers.filter((tab) => tab.workerName === selector)
  if (matches.length === 1 && matches[0]) return matches[0]
  if (matches.length > 1) {
    throw new Error(
      `worker selector is ambiguous: ${selector} (${matches.map((tab) => tab.id).join(', ')})`
    )
  }
  throw new Error(`worker not found: ${selector}`)
}

export function normalizeTurnOutcome(outcome: TurnOutcome): WorkerOutcome {
  switch (outcome.outcome) {
    case 'completed':
      return { durationMs: outcome.durationMs, status: 'completed' }
    case 'question':
      return {
        durationMs: outcome.durationMs,
        kind: outcome.kind,
        options: outcome.options,
        question: outcome.question,
        status: 'question',
      }
    case 'timeout':
      return { durationMs: outcome.durationMs, status: 'timeout' }
    case 'error':
      return { durationMs: outcome.durationMs, error: outcome.error, status: 'error' }
  }
}

export function workerOutcomeExitCode(outcome: WorkerOutcome): number {
  switch (outcome.status) {
    case 'completed':
    case 'dispatched':
      return EXIT_OK
    case 'question':
      return EXIT_QUESTION
    case 'timeout':
      return EXIT_TIMEOUT
    case 'error':
      return EXIT_RUNTIME
  }
}

async function requireTurnCapabilities(ctx: CliContext): Promise<{
  daemon: Awaited<ReturnType<CliContext['getDaemon']>>
}> {
  const daemon = await ctx.getDaemon()
  if (
    !daemon.hasCapability(IPC_CAPABILITY_THIN_ATTACH) ||
    !daemon.hasCapability(IPC_CAPABILITY_TURN_LIFECYCLE) ||
    !daemon.hasCapability(IPC_CAPABILITY_QUESTION_EVENTS)
  ) {
    throw new Error('daemon predates worker turn lifecycle — restart aimux')
  }
  return { daemon }
}

export async function dispatchWorkerPrompt(
  ctx: CliContext,
  tabId: string,
  text: string,
  options: { detach: boolean; timeoutMs: number }
): Promise<WorkerOutcome> {
  const { daemon } = await requireTurnCapabilities(ctx)
  const workspace = ctx.getWorkspace()
  const attach = await daemon.attach({ cols: 0, rows: 0, sessionId: workspace.id, thin: true })
  if (!attach.tabs.some((tab) => tab.id === tabId)) throw new Error(`tab not found: ${tabId}`)
  const payload = buildPromptPayload(text, false)

  if (!options.detach) {
    const outcome = await awaitTurn({
      assumeWorking: false,
      daemon,
      onArmed: async () => {
        await writePromptPayload(daemon, tabId, payload, true)
      },
      tabId,
      timeoutMs: options.timeoutMs,
    })
    return normalizeTurnOutcome(outcome)
  }

  const startedAt = Date.now()
  const uptake = new Promise<{ confirmed: true; ms: number } | { confirmed: false }>((resolve) => {
    const off = daemon.on('tabStatus', (event) => {
      if (event.tabId !== tabId || event.status !== 'working') return
      off()
      clearTimeout(timer)
      resolve({ confirmed: true, ms: Date.now() - startedAt })
    })
    const timer = setTimeout(
      () => {
        off()
        resolve({ confirmed: false })
      },
      Math.min(options.timeoutMs, DETACH_UPTAKE_TIMEOUT_MS)
    )
  })
  await writePromptPayload(daemon, tabId, payload, true)
  const result = await uptake
  if (!result.confirmed) {
    return {
      durationMs: Date.now() - startedAt,
      error: 'prompt was written but worker uptake was not confirmed',
      status: 'error',
      uptake: result,
    }
  }
  return {
    durationMs: Date.now() - startedAt,
    status: 'dispatched',
    uptake: result,
  }
}

export async function awaitExistingWorker(
  ctx: CliContext,
  tabId: string,
  timeoutMs: number
): Promise<WorkerOutcome> {
  const { daemon } = await requireTurnCapabilities(ctx)
  const attach = await daemon.attach({
    cols: 0,
    rows: 0,
    sessionId: ctx.getWorkspace().id,
    thin: true,
  })
  const tab = attach.tabs.find((entry) => entry.id === tabId)
  if (!tab) throw new Error(`tab not found: ${tabId}`)
  if (tab.activity === 'waiting-input') {
    const question =
      tab.viewport && tab.viewport.lines.length > 0
        ? snapshotTailLines(tab.viewport, QUESTION_TAIL_LINES, { trim: true }).join('\n')
        : ''
    return { durationMs: 0, kind: 'question', question, status: 'question' }
  }
  return normalizeTurnOutcome(
    await awaitTurn({
      assumeWorking: tab.activity === 'working',
      daemon,
      tabId,
      timeoutMs,
    })
  )
}

export function workerEnvelope(
  worker: WorkerView,
  outcome?: WorkerOutcome
): Record<string, unknown> {
  return {
    schemaVersion: WORKER_SCHEMA_VERSION,
    worker,
    ...(outcome === undefined ? {} : { outcome }),
  }
}
