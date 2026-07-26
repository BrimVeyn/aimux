import type { SessionRecord, TerminalSnapshot, WorktreeRecord } from '../../../state/types'
import type { CliContext } from '../../context'

import {
  IPC_CAPABILITY_LIST_TABS,
  IPC_CAPABILITY_QUESTION_EVENTS,
  IPC_CAPABILITY_THIN_ATTACH,
  IPC_CAPABILITY_TURN_LIFECYCLE,
  IPC_CAPABILITY_WORKER_METADATA,
  type TabSessionSummary,
} from '../../../ipc/protocol'
import {
  listWorkspaces,
  workspaceIdentity,
  workspaceRepoRoot,
} from '../../client/workspace-resolver'
import { CliUsageError } from '../../flags'
import {
  EXIT_OK,
  EXIT_PENDING_SUBMIT,
  EXIT_QUESTION,
  EXIT_RUNTIME,
  EXIT_TIMEOUT,
} from '../../output'
import { snapshotTailLines, snapshotToLines } from '../../snapshot-render'
import { awaitTurn, type TurnOutcome } from '../tab/await-turn'
import { buildPromptPayload, writePromptPayload } from '../tab/prompt-io'

export const WORKER_SCHEMA_VERSION = 1
export const WORKER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const QUESTION_TAIL_LINES = 25

/**
 * Default window for the `--detach` submit→`working` confirmation. Overridable
 * per call with `--uptake-timeout`: a cold assistant on a loaded machine can
 * take longer than this to accept its first keystroke, and the old hard ceiling
 * (min(--timeout, 15s)) made that unfixable from the outside.
 */
export const DETACH_UPTAKE_TIMEOUT_MS = 15_000
/** Second, shorter window used after the idempotent submit retry. */
const UPTAKE_RESUBMIT_WINDOW_MS = 5_000
/** One retry is enough: the payload is already in the composer either way. */
const MAX_UPTAKE_RESUBMITS = 1
/**
 * How long to wait for a freshly spawned assistant to paint anything before
 * writing its prompt. A booting TUI has a pty that buffers the payload (which
 * is why the text shows up intact) but is not yet reading keystrokes, so the
 * submitting `\r` is consumed before the composer exists. First paint is a
 * generic, assistant-agnostic "it is reading input now" signal.
 */
const TAB_FIRST_PAINT_TIMEOUT_MS = 10_000
/** Settle after a *just observed* first paint, before writing. */
const TAB_FIRST_PAINT_SETTLE_MS = 250
/** Chord that clears the composer line (readline kill-line). */
const CLEAR_COMPOSER_CHORD = '<C-u>'

export interface WorkerView {
  activity?: TabSessionSummary['activity']
  assistant: string
  branch: string | null
  command: string
  lastLine?: string
  name: string
  path: string | null
  /** Repository the worker's worktree was cut from — see `workspaceRepoRoot`. */
  repoRoot: string | null
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
  status: 'completed' | 'dispatched' | 'pending-submit' | 'question' | 'timeout' | 'error'
  uptake?: {
    confirmed: boolean
    activity?: TabSessionSummary['activity']
    ms?: number
    resubmits?: number
  }
}

/** A worker plus the workspace it is actually bound to. */
export interface WorkerTarget {
  tab: TabSessionSummary
  workspace: SessionRecord
}

export function validateWorkerName(name: string): void {
  if (!WORKER_NAME_PATTERN.test(name)) {
    throw new CliUsageError(
      'worker name must be 1-64 characters: letters, numbers, dot, underscore, or hyphen'
    )
  }
}

function worktreeFor(
  workspace: SessionRecord,
  worktreeId: string | undefined
): WorktreeRecord | undefined {
  if (worktreeId === undefined) return undefined
  return workspace.worktrees?.find((worktree) => worktree.id === worktreeId)
}

export function workerView(workspace: SessionRecord, tab: TabSessionSummary): WorkerView {
  if (tab.workerName === undefined) {
    throw new Error(`tab is not a named worker: ${tab.id}`)
  }
  const worktree = worktreeFor(workspace, tab.worktreeId)
  return {
    activity: tab.activity,
    assistant: tab.assistant,
    branch: worktree?.branch ?? null,
    command: tab.command,
    lastLine: tab.lastLine,
    name: tab.workerName,
    path: worktree?.path ?? null,
    repoRoot: worktree?.repoRoot ?? workspaceRepoRoot(workspace),
    status: tab.status,
    tabId: tab.id,
    title: tab.title,
    worktreeId: tab.worktreeId ?? null,
  }
}

async function requireWorkerCapabilities(
  ctx: CliContext
): Promise<Awaited<ReturnType<CliContext['getDaemon']>>> {
  const daemon = await ctx.getDaemon()
  if (
    !daemon.hasCapability(IPC_CAPABILITY_LIST_TABS) ||
    !daemon.hasCapability(IPC_CAPABILITY_WORKER_METADATA)
  ) {
    throw new Error('daemon predates worker commands — restart aimux')
  }
  return daemon
}

export async function listNamedWorkerTabs(
  ctx: CliContext,
  workspace: SessionRecord = ctx.getWorkspace()
): Promise<TabSessionSummary[]> {
  const daemon = await requireWorkerCapabilities(ctx)
  return (await daemon.listTabs(workspace.id)).tabs.filter((tab) => tab.workerName !== undefined)
}

/** Every named worker the daemon knows about, across every catalogued workspace. */
export async function listWorkerTargets(ctx: CliContext): Promise<WorkerTarget[]> {
  const daemon = await requireWorkerCapabilities(ctx)
  const targets: WorkerTarget[] = []
  for (const workspace of ctx.getWorkspaces?.() ?? listWorkspaces()) {
    const { tabs } = await daemon.listTabs(workspace.id)
    for (const tab of tabs) {
      if (tab.workerName !== undefined) targets.push({ tab, workspace })
    }
  }
  return targets
}

function matches(tab: TabSessionSummary, selector: string): boolean {
  return tab.id === selector || tab.workerName === selector
}

/**
 * Resolve a worker selector to the tab AND the workspace that owns it.
 *
 * A worker is addressed for its whole lifetime, but the *active* workspace can
 * change under it (the UI switching projects is enough). Resolving only against
 * the active workspace is what made a live fleet look dead — `worker list`
 * returning `[]` and `worker await` saying "worker not found" while all twelve
 * workers were healthy. So when the workspace was merely inferred, fall back to
 * a catalog-wide search and bind to wherever the worker actually lives; when it
 * was pinned (`--workspace` / `AIMUX_WORKSPACE`), keep the boundary but name the
 * workspace that does hold it instead of a bare "not found".
 */
export async function resolveWorkerTarget(
  ctx: CliContext,
  selector: string
): Promise<WorkerTarget> {
  const workspace = ctx.getWorkspace()
  const local = (await listNamedWorkerTabs(ctx, workspace)).filter((tab) => matches(tab, selector))
  if (local.length > 1) {
    throw new Error(
      `worker selector is ambiguous in workspace "${workspace.name}": ${selector} (${local
        .map((tab) => tab.id)
        .join(', ')})`
    )
  }
  const only = local[0]
  if (only) return { tab: only, workspace }

  const elsewhere = (await listWorkerTargets(ctx)).filter(
    (target) => target.workspace.id !== workspace.id && matches(target.tab, selector)
  )
  const pinned = (ctx.getWorkspaceOrigin?.() ?? 'active') !== 'active'
  if (elsewhere.length === 1 && elsewhere[0] && !pinned) return elsewhere[0]
  if (elsewhere.length > 0) {
    const where = elsewhere
      .map((target) => `${target.workspace.name} (${target.tab.id})`)
      .join(', ')
    throw new Error(
      `worker not found in workspace "${workspace.name}": ${selector} — it lives in ${where}; re-run with --workspace`
    )
  }
  throw new Error(`worker not found in workspace "${workspace.name}": ${selector}`)
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
    case 'pending-submit':
      return EXIT_PENDING_SUBMIT
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

function hasPaintedContent(viewport: TerminalSnapshot | undefined): boolean {
  if (!viewport) return false
  return snapshotToLines(viewport).some((line) => line.trim() !== '')
}

/**
 * Resolve once the tab has painted something, i.e. the assistant is up far
 * enough to be reading keystrokes. Returns immediately for a tab that already
 * painted, and gives up (rather than blocking the dispatch) if nothing paints
 * within the window.
 */
async function waitForFirstPaint(
  daemon: Awaited<ReturnType<CliContext['getDaemon']>>,
  tabId: string,
  seed: TerminalSnapshot | undefined
): Promise<void> {
  if (hasPaintedContent(seed)) return
  const painted = await new Promise<boolean>((resolve) => {
    const off = daemon.on('tabRender', (event) => {
      if (event.tabId !== tabId || !hasPaintedContent(event.viewport)) return
      off()
      clearTimeout(timer)
      resolve(true)
    })
    const timer = setTimeout(() => {
      off()
      resolve(false)
    }, TAB_FIRST_PAINT_TIMEOUT_MS)
  })
  // Even a painted TUI needs a beat between "first frame" and "composer is
  // interactive". Skip the settle when first paint never arrived — waiting
  // longer on a tab that produced nothing buys nothing.
  if (painted) await Bun.sleep(TAB_FIRST_PAINT_SETTLE_MS)
}

interface UptakeResult {
  activity?: TabSessionSummary['activity']
  confirmed: boolean
  ms?: number
}

// `async` only to satisfy promise-function-async; the body has no `await`, so
// the executor below still runs synchronously and the `tabStatus` subscription
// is armed before this returns — callers write to the tab right after calling.
async function armUptake(
  daemon: Awaited<ReturnType<CliContext['getDaemon']>>,
  tabId: string,
  windowMs: number,
  startedAt: number
): Promise<UptakeResult> {
  return new Promise<UptakeResult>((resolve) => {
    const off = daemon.on('tabStatus', (event) => {
      if (event.tabId !== tabId || event.status !== 'working') return
      off()
      clearTimeout(timer)
      resolve({ activity: 'working', confirmed: true, ms: Date.now() - startedAt })
    })
    const timer = setTimeout(() => {
      off()
      resolve({ confirmed: false })
    }, windowMs)
  })
}

/**
 * Uptake read from the tab's *current* activity rather than from a transition.
 * `tabStatus` is edge-triggered, so a transition can be missed; and a worker that
 * answered with a question never emitted `working` at all. Both mean the prompt
 * was taken up. Returns undefined when the tab is genuinely idle.
 */
async function liveUptake(
  daemon: Awaited<ReturnType<CliContext['getDaemon']>>,
  sessionId: string,
  tabId: string,
  startedAt: number
): Promise<UptakeResult | undefined> {
  const live = (await daemon.listTabs(sessionId)).tabs.find((tab) => tab.id === tabId)
  if (live?.activity !== 'working' && live?.activity !== 'waiting-input') return undefined
  return { activity: live.activity, confirmed: true, ms: Date.now() - startedAt }
}

export interface DispatchOptions {
  /**
   * Gate the first write on the tab painting. Set only for a tab this call just
   * spawned: an already-running worker has painted long ago, so waiting on a
   * fresh render event would just stall on a quiet screen.
   */
  awaitFirstPaint?: boolean
  detach: boolean
  /** Clear the composer (`<C-u>`) before writing, so stray text can't merge in. */
  replace?: boolean
  timeoutMs: number
  /** Window for the detached submit→`working` confirmation. */
  uptakeTimeoutMs?: number
}

export async function dispatchWorkerPrompt(
  ctx: CliContext,
  workspace: SessionRecord,
  tabId: string,
  text: string,
  options: DispatchOptions
): Promise<WorkerOutcome> {
  const { daemon } = await requireTurnCapabilities(ctx)
  const attach = await daemon.attach({ cols: 0, rows: 0, sessionId: workspace.id, thin: true })
  const attached = attach.tabs.find((tab) => tab.id === tabId)
  if (!attached) throw new Error(`tab not found: ${tabId}`)
  const payload = buildPromptPayload(text, false)
  const write = async (): Promise<void> => {
    if (options.replace === true) {
      await writePromptPayload(daemon, tabId, buildPromptPayload(CLEAR_COMPOSER_CHORD, true), false)
    }
    await writePromptPayload(daemon, tabId, payload, true)
  }

  if (options.awaitFirstPaint === true) {
    await waitForFirstPaint(daemon, tabId, attached.viewport)
  }

  if (!options.detach) {
    const outcome = await awaitTurn({
      assumeWorking: false,
      daemon,
      onArmed: write,
      tabId,
      timeoutMs: options.timeoutMs,
    })
    return normalizeTurnOutcome(outcome)
  }

  const startedAt = Date.now()
  const window = options.uptakeTimeoutMs ?? DETACH_UPTAKE_TIMEOUT_MS
  const first = armUptake(daemon, tabId, window, startedAt)
  await write()
  let result = await first
  let resubmits = 0

  while (!result.confirmed && resubmits < MAX_UPTAKE_RESUBMITS) {
    const live = await liveUptake(daemon, workspace.id, tabId, startedAt)
    if (live) {
      result = live
      break
    }
    // The payload is already in the composer; a bare `\r` just submits what is
    // sitting there. Idempotent, and it is exactly the manual recovery this
    // used to force on the caller.
    resubmits++
    const retry = armUptake(daemon, tabId, UPTAKE_RESUBMIT_WINDOW_MS, startedAt)
    await daemon.expectOk('write', { data: '\r', tabId })
    result = await retry
  }
  // Last look before declaring failure: never report a healthy, working worker
  // as pending just because an edge-triggered event was missed.
  if (!result.confirmed) {
    result = (await liveUptake(daemon, workspace.id, tabId, startedAt)) ?? result
  }

  if (!result.confirmed) {
    return {
      durationMs: Date.now() - startedAt,
      error: `prompt is in the composer but no turn started after ${resubmits + 1} submit attempt(s); recover with \`aimux worker submit\``,
      status: 'pending-submit',
      uptake: { ...result, resubmits },
    }
  }
  return {
    durationMs: Date.now() - startedAt,
    status: 'dispatched',
    uptake: { ...result, resubmits },
  }
}

/**
 * Submit whatever is already sitting in a worker's composer and confirm uptake.
 * The recovery verb for a `pending-submit` outcome — awaitable, unlike the
 * `tab send <tab> "<CR>" --keys` dance it replaces.
 */
export async function submitWorkerPrompt(
  ctx: CliContext,
  workspace: SessionRecord,
  tabId: string,
  uptakeTimeoutMs: number
): Promise<WorkerOutcome> {
  const { daemon } = await requireTurnCapabilities(ctx)
  const attach = await daemon.attach({ cols: 0, rows: 0, sessionId: workspace.id, thin: true })
  if (!attach.tabs.some((tab) => tab.id === tabId)) throw new Error(`tab not found: ${tabId}`)
  const startedAt = Date.now()
  const uptake = armUptake(daemon, tabId, uptakeTimeoutMs, startedAt)
  await daemon.expectOk('write', { data: '\r', tabId })
  const result = await uptake
  if (!result.confirmed) {
    const live = await liveUptake(daemon, workspace.id, tabId, startedAt)
    if (live) {
      return { durationMs: Date.now() - startedAt, status: 'dispatched', uptake: live }
    }
    return {
      durationMs: Date.now() - startedAt,
      error: 'submitted but no turn started — the composer may be empty',
      status: 'pending-submit',
      uptake: result,
    }
  }
  return { durationMs: Date.now() - startedAt, status: 'dispatched', uptake: result }
}

export async function awaitExistingWorker(
  ctx: CliContext,
  workspace: SessionRecord,
  tabId: string,
  timeoutMs: number
): Promise<WorkerOutcome> {
  const { daemon } = await requireTurnCapabilities(ctx)
  const attach = await daemon.attach({
    cols: 0,
    rows: 0,
    sessionId: workspace.id,
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

/**
 * Versioned envelope. `workspace` is not decoration: without it a caller cannot
 * tell which project a worker belongs to, which is how a whole orchestration
 * can run against the wrong repository unnoticed.
 */
export function workerEnvelope(
  workspace: SessionRecord,
  worker: WorkerView,
  outcome?: WorkerOutcome
): Record<string, unknown> {
  return {
    schemaVersion: WORKER_SCHEMA_VERSION,
    worker,
    workspace: workspaceIdentity(workspace),
    ...(outcome === undefined ? {} : { outcome }),
  }
}
