import type { AssistantId, TabSession } from '../state/types'
import type { SideEffectContext } from './side-effect-context'

import { logInputDebug } from '../debug/input-log'
import { createPrefixedId } from '../platform/id'
import {
  assistantAcceptsPromptArg,
  buildAssistantSessionArgs,
  getAllAssistantOptions,
  getAssistantOption,
  isCommandAvailable,
  parseCommand,
  stripInjectedSessionArgs,
} from '../pty/command-registry'
import { createTerminalBounds } from '../state/layout-resize'
import {
  computePaneRects,
  createLeaf,
  getTreeForTab,
  PANE_BORDER,
  type SplitDirection,
  splitNode,
} from '../state/layout-tree'
import { getCurrentProject } from '../state/project-workspaces'
import { createDefaultTerminalModes } from '../state/terminal-modes'
import { getActiveWorkspace } from '../state/workspace-view'
import { injectPromptWhenReady } from './prompt-injection'
import { getSelectedAssistantOption } from './selection'

/**
 * How long a freshly spawned assistant is given to draw something before the
 * tab stops being treated as "still starting up".
 */
const STARTUP_GRACE_MS = 5_000

export function confirmSplitSelection(ctx: SideEffectContext): void {
  const { dispatch, state } = ctx
  const option = getSelectedAssistantOption(state)
  const direction = state.modal.type === 'split-picker' ? state.modal.splitDirection : 'vertical'
  const customCommand = state.customCommands[option.id]
  const tab = createTabSession(
    option.id,
    customCommand,
    state.customCommands,
    getActiveWorkspace(getCurrentProject(state))?.id
  )
  dispatch({ type: 'close-modal' })
  executeSplitPane(ctx, direction, tab)
  dispatch({ focusMode: 'terminal-input', type: 'set-focus-mode' })
}

function createTabId(): string {
  return createPrefixedId('tab')
}

export function createTabSession(
  assistant: AssistantId,
  customCommand?: string,
  customCommands?: Record<string, string>,
  workspaceId?: string
): TabSession {
  const allOptions = getAllAssistantOptions(customCommands ?? {})
  const option = allOptions.find((o) => o.id === assistant) ?? getAssistantOption(0)

  return {
    activity: 'idle',
    assistant,
    buffer: '',
    command: customCommand ?? option.command,
    id: createTabId(),
    // Minted up front, before the CLI has ever run, so the very first spawn can
    // claim it. Only for assistants that can be told their session id — a shell
    // tab would just carry a uuid nothing reads.
    sessionId: option.session ? crypto.randomUUID() : undefined,
    status: 'starting',
    terminalModes: createDefaultTerminalModes(),
    title: option.label,
    workspaceId,
  }
}

/** Everything `startTabSession` needs from the side-effect context. */
type StartTabSessionContext = Pick<
  SideEffectContext,
  'backend' | 'clearStartupGrace' | 'dispatch' | 'startStartupGrace' | 'state'
>

export interface StartTabSessionOptions {
  cols: number
  rows: number
  cwd?: string
  /** Default true: only a tab the user did not just ask for opts out. */
  autoRenameCandidate?: boolean
  /**
   * Appended after the command's own args. Kept out of `tab.command` on purpose:
   * an initial prompt is up to a few thousand characters, and `command` is what
   * the UI shows, what the snapshot persists, and what the custom-command editor
   * round-trips.
   */
  extraArgs?: string[]
}

export function startTabSession(
  ctx: StartTabSessionContext,
  tab: Pick<TabSession, 'id' | 'assistant' | 'title' | 'command' | 'sessionId' | 'workspaceId'>,
  { autoRenameCandidate = true, cols, cwd, extraArgs, rows }: StartTabSessionOptions
): void {
  const { backend, clearStartupGrace, dispatch } = ctx
  logInputDebug('app.tab.start.request', {
    cols,
    command: tab.command,
    cwd: cwd ?? null,
    rows,
    tabId: tab.id,
    title: tab.title,
    workspaceId: tab.workspaceId ?? null,
  })
  ctx.startStartupGrace(tab.id, STARTUP_GRACE_MS)

  const { args, executable } = parseCommand(tab.command)
  // `tab.command` is not always the string this client wrote: a hydrate from the
  // daemon (or a snapshot taken after one) hands back the whole argv of the last
  // spawn, session flags included. Strip ours back out before adding this
  // spawn's, or claude exits on the duplicate and takes the tab with it.
  const baseArgs = stripInjectedSessionArgs(tab.assistant, ctx.state.customCommands, args)
  // Ahead of `extraArgs` because that is where an initial prompt goes, and the
  // prompt is positional — a flag after it would be read as part of it.
  const sessionArgs =
    tab.sessionId == null
      ? []
      : buildAssistantSessionArgs(tab.assistant, ctx.state.customCommands, tab.sessionId)

  if (!isCommandAvailable(executable)) {
    clearStartupGrace(tab.id)
    dispatch({
      message: `[command not found] ${executable} is not available in PATH.`,
      tabId: tab.id,
      type: 'set-tab-error',
    })
    return
  }

  backend.createSession({
    args: [...baseArgs, ...sessionArgs, ...(extraArgs ?? [])],
    assistant: tab.assistant,
    autoRenameCandidate,
    cols,
    command: executable,
    cwd,
    rows,
    tabId: tab.id,
    title: tab.title,
    workspaceId: tab.workspaceId,
  })
}

/**
 * Returns the id of the tab it created, so a caller can write into it.
 *
 * `initialPromptArgs` hands the prompt to the CLI at spawn — see
 * `assistantAcceptsPromptArg`. Callers pass it only for assistants that support
 * it, and fall back to `injectPromptWhenReady` otherwise.
 */
export function launchAssistant(
  ctx: SideEffectContext,
  assistant: AssistantId,
  workspaceId?: string,
  initialPromptArgs?: string[]
): string {
  const { dispatch, state } = ctx
  const customCommand = state.customCommands[assistant]
  const tab = createTabSession(
    assistant,
    customCommand,
    state.customCommands,
    workspaceId ?? getActiveWorkspace(getCurrentProject(state))?.id
  )
  logInputDebug('app.launchAssistant', {
    assistant,
    command: tab.command,
    tabId: tab.id,
  })
  dispatch({ tab, type: 'add-tab' })
  dispatch({ focusMode: 'terminal-input', type: 'set-focus-mode' })
  startTabSession(ctx, tab, {
    cols: state.layout.terminalCols,
    cwd: getTabProjectPath(ctx, tab),
    extraArgs: initialPromptArgs,
    rows: state.layout.terminalRows,
  })
  return tab.id
}

/**
 * Spawn the assistant and get `prompt` in front of it.
 *
 * Handed over at spawn where the CLI takes one. Pasting it into a live TUI
 * works — it is what the `<C-p>` flow did — but it means polling for readiness,
 * probing the screen, and retrying. An argv slot has none of those failure
 * modes. Deciding it here means the prompt cannot be built twice, from two
 * different reads of the store.
 */
export function launchWithPrompt(
  ctx: SideEffectContext,
  assistant: AssistantId,
  prompt: string,
  workspaceId: string | undefined
): void {
  const atSpawn = prompt !== '' && assistantAcceptsPromptArg(assistant, ctx.state.customCommands)
  logInputDebug('app.launchSelectedAssistant', {
    assistant,
    chained: workspaceId != null,
    promptAtSpawn: atSpawn,
    promptLength: prompt.length,
  })

  const tabId = launchAssistant(ctx, assistant, workspaceId, atSpawn ? [prompt] : undefined)
  if (prompt !== '' && !atSpawn) {
    void injectPromptWhenReady({
      backend: ctx.backend,
      getState: ctx.getState,
      prompt,
      tabId,
    })
  }
}

export function getTabProjectPath(
  ctx: SideEffectContext,
  tab: Pick<TabSession, 'workspaceId'>
): string | undefined {
  // Scoped to the current project on purpose: a tab pinned to a workspace of
  // some other project gets the current project's path, not that project's.
  const project = getCurrentProject(ctx.state)
  const workspace = project?.workspaces?.find((entry) => entry.id === tab.workspaceId)
  if (workspace) return workspace.path
  return ctx.getCurrentProjectProjectPath()
}

export function startExistingTab(ctx: SideEffectContext, tab: TabSession): void {
  startTabSession(ctx, tab, {
    autoRenameCandidate: false,
    cols: ctx.state.layout.terminalCols,
    cwd: getTabProjectPath(ctx, tab),
    rows: ctx.state.layout.terminalRows,
  })
}

export function executeSplitPane(
  ctx: SideEffectContext,
  direction: SplitDirection,
  tab: TabSession
): void {
  const { dispatch, state } = ctx
  const activeTabId = state.activeTabId
  if (!(activeTabId != null && activeTabId !== '')) {
    return
  }

  const existingTree = getTreeForTab(state.layoutTrees, state.tabGroupMap, activeTabId)
  const baseTree = existingTree ?? createLeaf(activeTabId)
  const newTree = splitNode(baseTree, activeTabId, direction, tab.id)
  const bounds = createTerminalBounds(state.layout.terminalCols, state.layout.terminalRows)
  const paneRect = computePaneRects(newTree, bounds).get(tab.id)

  dispatch({ direction, newTab: tab, type: 'split-pane' })
  startTabSession(ctx, tab, {
    cols: Math.max(1, (paneRect?.cols ?? state.layout.terminalCols) - PANE_BORDER * 2),
    cwd: getTabProjectPath(ctx, tab),
    rows: Math.max(1, (paneRect?.rows ?? state.layout.terminalRows) - PANE_BORDER * 2),
  })
}
