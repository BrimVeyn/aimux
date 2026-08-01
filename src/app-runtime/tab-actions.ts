import type { WorkspaceTemplate, WorkspaceTemplatePane } from '../config'
import type { SessionBackend } from '../session-backend/types'
import type { AppAction } from '../state/actions'
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
import { writeToTab } from './pty-write'
import { getSelectedAssistantOption } from './selection'

/**
 * How long a freshly spawned assistant is given to draw something before the
 * tab stops being treated as "still starting up".
 */
const STARTUP_GRACE_MS = 5_000

/**
 * Delay before injecting a template pane's `send` payload into its PTY.
 * Short enough that shells (which print a prompt within ~100 ms) receive the
 * command after their prompt is drawn; long enough to clear most PTY init
 * races. Not tied to STARTUP_GRACE_MS because that is the assistant timeout,
 * not a readiness signal. See review note: a `tab.status === 'running'`
 * subscription would be more robust and is the planned follow-up.
 */
const TEMPLATE_SEND_DELAY_MS = 600

export function applyWorkspaceTemplate(
  ctx: SideEffectContext,
  template: WorkspaceTemplate,
  workspaceId: string,
  workspacePath: string
): void {
  let firstTabId: string | null = null

  for (const templateTab of template.tabs) {
    const localToTabId = new Map<string, string>()

    for (let i = 0; i < templateTab.panes.length; i++) {
      const pane = templateTab.panes[i]
      if (!pane) continue
      const tab = createPaneTab(ctx, pane, workspaceId)
      localToTabId.set(pane.id, tab.id)

      if (i === 0) {
        if (firstTabId == null) firstTabId = tab.id
        ctx.dispatch({ tab, type: 'add-tab' })
        startTabSession(
          ctx.backend,
          ctx.dispatch,
          ctx.clearStartupGrace,
          (tabId) => ctx.startStartupGrace(tabId, STARTUP_GRACE_MS),
          tab,
          ctx.state.layout.terminalCols,
          ctx.state.layout.terminalRows,
          workspacePath
        )
      } else {
        const splitFromId =
          pane.splitFrom != null && pane.splitFrom !== ''
            ? localToTabId.get(pane.splitFrom)
            : undefined
        const direction: SplitDirection = pane.direction ?? 'vertical'
        if (splitFromId == null || splitFromId === '') {
          logInputDebug('template.splitFrom.unresolved', {
            paneId: pane.id,
            splitFrom: pane.splitFrom ?? null,
            templateId: template.id,
          })
          continue
        }
        splitFromTab(ctx, splitFromId, direction, tab, workspacePath)
        if (pane.ratio != null) {
          const sourceRatio = clampSplitRatio(1 - pane.ratio)
          ctx.dispatch({
            axis: direction,
            ratio: sourceRatio,
            tabId: tab.id,
            type: 'set-split-ratio',
          })
        }
      }

      if (pane.send != null && pane.send !== '') {
        const payload = `${pane.send}\n`
        const targetTabId = tab.id
        setTimeout(() => {
          const latest = ctx.getState()
          const latestTab = latest.tabs.find((entry) => entry.id === targetTabId)
          writeToTab(ctx.backend, targetTabId, latestTab, payload)
        }, TEMPLATE_SEND_DELAY_MS)
      }
    }
  }

  if (firstTabId != null) {
    ctx.dispatch({ tabId: firstTabId, type: 'set-active-tab' })
  }
}

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

export function startTabSession(
  backend: SessionBackend,
  dispatch: (action: AppAction) => void,
  clearStartupGrace: (tabId: string) => void,
  startStartupGrace: (tabId: string) => void,
  tab: Pick<TabSession, 'id' | 'assistant' | 'title' | 'command' | 'workspaceId'>,
  cols: number,
  rows: number,
  cwd?: string,
  autoRenameCandidate = true,
  /**
   * Appended after the command's own args. Kept out of `tab.command` on purpose:
   * an initial prompt is up to a few thousand characters, and `command` is what
   * the UI shows, what the snapshot persists, and what the custom-command editor
   * round-trips.
   */
  extraArgs?: string[]
): void {
  logInputDebug('app.tab.start.request', {
    cols,
    command: tab.command,
    cwd: cwd ?? null,
    rows,
    tabId: tab.id,
    title: tab.title,
    workspaceId: tab.workspaceId ?? null,
  })
  startStartupGrace(tab.id)

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
  const { backend, clearStartupGrace, dispatch, startStartupGrace, state } = ctx
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
  startTabSession(
    backend,
    dispatch,
    clearStartupGrace,
    (tabId) => startStartupGrace(tabId, STARTUP_GRACE_MS),
    tab,
    state.layout.terminalCols,
    state.layout.terminalRows,
    getTabProjectPath(ctx, tab),
    true,
    initialPromptArgs
  )
  return tab.id
}

export function createPaneTab(
  ctx: SideEffectContext,
  pane: WorkspaceTemplatePane,
  workspaceId: string
): TabSession {
  // Accept `'shell'` as an alias for the registered `'terminal'` assistant so
  // template examples using the more intuitive name don't silently fall back
  // to Claude (createTabSession's unknown-id fallback resolves to index 0).
  const assistantId = (pane.assistant === 'shell' ? 'terminal' : pane.assistant) as AssistantId
  const customCommand = ctx.state.customCommands[assistantId]
  return createTabSession(assistantId, customCommand, ctx.state.customCommands, workspaceId)
}

function splitFromTab(
  ctx: SideEffectContext,
  baseTabId: string,
  direction: SplitDirection,
  newTab: TabSession,
  cwd?: string
): void {
  ctx.dispatch({ tabId: baseTabId, type: 'set-active-tab' })

  const latest = ctx.getState()
  const existingTree = getTreeForTab(latest.layoutTrees, latest.tabGroupMap, baseTabId)
  const baseTree = existingTree ?? createLeaf(baseTabId)
  const newTree = splitNode(baseTree, baseTabId, direction, newTab.id)
  const bounds = createTerminalBounds(latest.layout.terminalCols, latest.layout.terminalRows)
  const paneRect = computePaneRects(newTree, bounds).get(newTab.id)

  ctx.dispatch({ direction, newTab, type: 'split-pane' })
  startTabSession(
    ctx.backend,
    ctx.dispatch,
    ctx.clearStartupGrace,
    (tabId) => ctx.startStartupGrace(tabId, STARTUP_GRACE_MS),
    newTab,
    Math.max(1, (paneRect?.cols ?? latest.layout.terminalCols) - PANE_BORDER * 2),
    Math.max(1, (paneRect?.rows ?? latest.layout.terminalRows) - PANE_BORDER * 2),
    cwd
  )
}

function clampSplitRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  return Math.min(0.85, Math.max(0.15, value))
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
  const { backend, clearStartupGrace, dispatch, startStartupGrace, state } = ctx
  startTabSession(
    backend,
    dispatch,
    clearStartupGrace,
    (tabId) => startStartupGrace(tabId, STARTUP_GRACE_MS),
    tab,
    state.layout.terminalCols,
    state.layout.terminalRows,
    getTabProjectPath(ctx, tab),
    false
  )
}

export function executeSplitPane(
  ctx: SideEffectContext,
  direction: SplitDirection,
  tab: TabSession
): void {
  const { backend, clearStartupGrace, dispatch, startStartupGrace, state } = ctx
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
  startTabSession(
    backend,
    dispatch,
    clearStartupGrace,
    (tabId) => startStartupGrace(tabId, STARTUP_GRACE_MS),
    tab,
    Math.max(1, (paneRect?.cols ?? state.layout.terminalCols) - PANE_BORDER * 2),
    Math.max(1, (paneRect?.rows ?? state.layout.terminalRows) - PANE_BORDER * 2),
    getTabProjectPath(ctx, tab)
  )
}
