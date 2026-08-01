import type { AssistantId, TabSession } from '../state/types'
import type { SideEffectContext } from './side-effect-context'

import { logInputDebug } from '../debug/input-log'
import { createPrefixedId } from '../platform/id'
import {
  getAllAssistantOptions,
  getAssistantOption,
  isCommandAvailable,
  parseCommand,
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
import { getActiveWorkspace } from '../state/project-workspaces'
import { createDefaultTerminalModes } from '../state/terminal-modes'
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
    getActiveWorkspace(
      state.currentProjectId != null && state.currentProjectId !== ''
        ? state.projects.find((s) => s.id === state.currentProjectId)
        : undefined
    )?.id
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
    status: 'starting',
    terminalModes: createDefaultTerminalModes(),
    title: option.label,
    workspaceId,
  }
}

/** Everything `startTabSession` needs from the side-effect context. */
type StartTabSessionContext = Pick<
  SideEffectContext,
  'backend' | 'clearStartupGrace' | 'dispatch' | 'startStartupGrace'
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
  tab: Pick<TabSession, 'id' | 'assistant' | 'title' | 'command' | 'workspaceId'>,
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
    args: extraArgs && extraArgs.length > 0 ? [...args, ...extraArgs] : args,
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
    workspaceId ??
      getActiveWorkspace(
        state.currentProjectId != null && state.currentProjectId !== ''
          ? state.projects.find((s) => s.id === state.currentProjectId)
          : undefined
      )?.id
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

export function getTabProjectPath(
  ctx: SideEffectContext,
  tab: Pick<TabSession, 'workspaceId'>
): string | undefined {
  const project =
    ctx.state.currentProjectId != null && ctx.state.currentProjectId !== ''
      ? ctx.state.projects.find((entry) => entry.id === ctx.state.currentProjectId)
      : undefined
  if (tab.workspaceId != null && tab.workspaceId !== '') {
    const workspace = project?.workspaces?.find((entry) => entry.id === tab.workspaceId)
    if (workspace) return workspace.path
  }
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
