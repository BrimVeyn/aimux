import type { CliRenderer } from '@opentui/core'

import {
  DEFAULT_EDITOR_ARGS,
  getExternalEditorConfig,
  isAutoCommitEnabled,
  KNOWN_GUI_EDITORS,
} from '@brimveyn/aimux-config'
import { $ } from 'bun'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join as joinPath, resolve as resolvePath } from 'node:path'

import type { SideEffect } from '../input/modes/types'
import type { SessionBackend } from '../session-backend/types'
import type { AppAction, AppState, AssistantId, TabSession, WorktreeRecord } from '../state/types'
import type { ThemeId } from '../ui/themes'

import { loadConfig, saveConfig, type WorktreeTemplate, type WorktreeTemplatePane } from '../config'
import { logInputDebug } from '../debug/input-log'
import { enqueueGitOp } from '../git/command-queue'
import { moveWorktree } from '../git/move-worktree'
import {
  createGitWorktree,
  getCurrentBranch,
  getHeadSha,
  getMainWorktreeRoot,
  listGitWorktrees,
  removeGitWorktree,
} from '../git/worktree'
import { createPrefixedId } from '../platform/id'
import {
  assertSafeAimuxWorktreePath,
  isInsideAimuxWorktreeRoot,
  makeWorktreePath,
  sanitizePathSegment,
} from '../platform/worktree-paths'
import { getProfileConfigDir } from '../profile-paths'
import {
  getAllAssistantOptions,
  getAssistantOption,
  isCommandAvailable,
  parseCommand,
} from '../pty/command-registry'
import { appStore } from '../state/app-store'
import { createTerminalBounds } from '../state/layout-resize'
import {
  allLeafIds,
  computePaneRects,
  createLeaf,
  getGroupIdForTab,
  getTreeForTab,
  PANE_BORDER,
  type SplitDirection,
  splitNode,
} from '../state/layout-tree'
import {
  filterAssistants,
  filterSessions,
  filterSnippets,
  getTemplateNoneOffset,
} from '../state/selectors'
import { saveSessionCatalog } from '../state/session-catalog'
import { pruneSnapshotOfWorktree } from '../state/session-persistence'
import {
  filterTabsForActiveWorktree,
  getActiveWorktree,
  getSessionProjectPath,
  withActiveWorktree,
} from '../state/session-worktrees'
import { getSnippetsCatalogPath, isConfigSnippetId } from '../state/snippet-catalog'
import { appReducer } from '../state/store'
import { buildTabEntries } from '../state/tab-entries'
import { createDefaultTerminalModes } from '../state/terminal-modes'
import { toast } from '../state/toast-store'
import { saveCurrentWorkspace } from '../state/workspace-save'
import { filterThemeIds } from '../ui/filter-themes'
import { scrollGitDiff } from '../ui/git-view-controls'
import { applyTheme, getCurrentMode, getTransparent, setMode, setTransparent } from '../ui/theme'
import { triggerAutoCommitNow } from './auto-commit-ref'
import { writeToTab } from './pty-write'
import {
  handleCreateSessionEffect,
  handleDeleteSessionEffect,
  handleRenameSessionEffect,
  handleSwitchSessionEffect,
  restartTabSession,
  switchSessionRecords,
} from './session-actions'
import {
  handleDeleteSnippetEffect,
  handleSaveSnippetEditorEffect,
  pasteSnippetToTab,
} from './snippet-actions'

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

export interface SideEffectContext {
  state: AppState
  dispatch: (action: AppAction) => void
  backend: SessionBackend
  renderer: CliRenderer
  themeId: ThemeId
  setThemeId: (id: ThemeId) => void
  activeTab: TabSession | undefined
  clearIdleTimer: (tabId: string) => void
  clearStartupGrace: (tabId: string) => void
  startStartupGrace: (tabId: string, timeoutMs: number) => void
  getState: () => AppState
  getCurrentSessionProjectPath: () => string | undefined
}

function getSelectedAssistantOption(state: AppState) {
  const all = getAllAssistantOptions(state.customCommands)
  if (state.modal.type === 'new-tab' && state.modal.selectedAssistantId != null) {
    const selectedAssistantId = state.modal.selectedAssistantId
    return all.find((entry) => entry.id === selectedAssistantId) ?? getAssistantOption(0)
  }
  const filter = state.modal.type === 'new-tab' ? state.modal.editBuffer : null
  const list = filterAssistants(all, filter)
  return list[state.modal.selectedIndex] ?? list[0] ?? getAssistantOption(0)
}

function handleSessionSelection(ctx: SideEffectContext): void {
  const { backend, dispatch, state } = ctx
  const selectedSession = getSelectedSession(state)
  logInputDebug('app.sessionPicker.confirm', {
    creatingNew: !selectedSession,
    selectedIndex: state.modal.selectedIndex,
    selectedSessionId: selectedSession?.id ?? null,
  })

  if (selectedSession) {
    handleSwitchSessionEffect(state, backend, dispatch, selectedSession)
    return
  }

  dispatch({ returnToSessionPicker: true, type: 'open-create-session-modal' })
}

function handleSelectedSessionDelete(ctx: SideEffectContext): void {
  const { backend, dispatch, state } = ctx
  const selectedSession = getSelectedSession(state)
  logInputDebug('app.sessionPicker.deleteSelected', {
    selectedIndex: state.modal.selectedIndex,
    selectedSessionId: selectedSession?.id ?? null,
  })

  if (selectedSession) {
    handleDeleteSessionEffect(state, backend, dispatch, selectedSession.id, {
      openSessionPicker: true,
    })
  }
}

function openSelectedSessionRename(ctx: SideEffectContext): void {
  const { dispatch, state } = ctx
  const selectedSession = getSelectedSession(state)
  if (!selectedSession) {
    return
  }

  logInputDebug('app.sessionPicker.openRenameModal', {
    selectedIndex: state.modal.selectedIndex,
    selectedSessionId: selectedSession.id,
  })
  dispatch({
    initialName: selectedSession.name,
    sessionTargetId: selectedSession.id,
    type: 'open-session-name-modal',
  })
}

function pasteSnippetToActiveGroup(ctx: SideEffectContext): void {
  const { activeTab, backend, state } = ctx
  const snippet = getSelectedSnippet(state)
  if (!snippet || !(state.activeTabId != null && state.activeTabId !== '')) {
    return
  }

  const groupId = getGroupIdForTab(state.tabGroupMap, state.activeTabId)
  const groupTree = groupId != null && groupId !== '' ? state.layoutTrees[groupId] : null
  if (!groupTree) {
    pasteSnippetToTab(backend, state.activeTabId, activeTab, snippet)
    return
  }

  for (const tabId of allLeafIds(groupTree)) {
    const tab = state.tabs.find((entry) => entry.id === tabId)
    if (tab) {
      pasteSnippetToTab(backend, tabId, tab, snippet)
    }
  }
}

function saveCustomCommandSelection(ctx: SideEffectContext): void {
  const { dispatch, state } = ctx
  if (state.modal.type !== 'new-tab' || state.modal.editingCommand === null) {
    return
  }
  const assistantId = state.modal.editingCommand
  if (state.modal.editBuffer === null) return

  const trimmed = state.modal.editBuffer.trim()
  const newCustomCommands = { ...state.customCommands }
  if (trimmed) {
    newCustomCommands[assistantId] = trimmed
  } else {
    delete newCustomCommands[assistantId]
  }

  saveConfig({
    ...loadConfig(),
    customCommands: newCustomCommands,
  })
  dispatch({ customCommands: newCustomCommands, type: 'set-custom-commands' })
  dispatch({ type: 'cancel-command-edit' })
}

function applyThemeEffect(
  effect: Extract<SideEffect, { type: 'apply-theme' }>,
  ctx: SideEffectContext
): void {
  const { state } = ctx
  const filter = state.modal.type === 'theme-picker' ? state.modal.editBuffer : null
  const ids = filterThemeIds(filter)

  switch (effect.action) {
    case 'open':
      applyTheme(ctx.themeId)
      return
    case 'restore':
      applyTheme(ctx.themeId)
      return
    case 'confirm': {
      const selectedId = ids[state.modal.selectedIndex]
      if (selectedId != null && selectedId !== '') {
        applyTheme(selectedId)
        ctx.setThemeId(selectedId)
        saveConfig({ ...loadConfig(), themeId: selectedId })
      }
      return
    }
    case 'preview': {
      if (ids.length === 0) return
      const nextIndex = (state.modal.selectedIndex + effect.delta + ids.length) % ids.length
      const previewId = ids[nextIndex]
      if (previewId != null && previewId !== '') {
        applyTheme(previewId)
      }
      return
    }
  }
}

function confirmSplitSelection(ctx: SideEffectContext): void {
  const { dispatch, state } = ctx
  const option = getSelectedAssistantOption(state)
  const direction = state.modal.type === 'split-picker' ? state.modal.splitDirection : 'vertical'
  const customCommand = state.customCommands[option.id]
  const tab = createTabSession(
    option.id,
    customCommand,
    state.customCommands,
    getActiveWorktree(
      state.currentSessionId != null && state.currentSessionId !== ''
        ? state.sessions.find((s) => s.id === state.currentSessionId)
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

function getSelectedSession(state: AppState) {
  const filter = state.modal.type === 'session-picker' ? state.modal.editBuffer : null
  return filterSessions(state.sessions, filter)[state.modal.selectedIndex]
}

function getSelectedSnippet(state: AppState) {
  const filter = state.modal.type === 'snippet-picker' ? state.modal.editBuffer : null
  return filterSnippets(state.snippets, filter)[state.modal.selectedIndex]
}

export function createTabSession(
  assistant: AssistantId,
  customCommand?: string,
  customCommands?: Record<string, string>,
  worktreeId?: string
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
    worktreeId,
  }
}

export function startTabSession(
  backend: SessionBackend,
  dispatch: (action: AppAction) => void,
  clearStartupGrace: (tabId: string) => void,
  startStartupGrace: (tabId: string) => void,
  tab: Pick<TabSession, 'id' | 'assistant' | 'title' | 'command'>,
  cols: number,
  rows: number,
  cwd?: string
): void {
  logInputDebug('app.tab.start.request', {
    cols,
    command: tab.command,
    cwd: cwd ?? null,
    rows,
    tabId: tab.id,
    title: tab.title,
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
    args,
    assistant: tab.assistant,
    cols,
    command: executable,
    cwd,
    rows,
    tabId: tab.id,
    title: tab.title,
  })
}

function getNewTabTargetWorktreeId(state: AppState): string | undefined {
  if (
    state.modal.type !== 'new-tab' ||
    !(state.currentSessionId != null && state.currentSessionId !== '')
  ) {
    return undefined
  }
  const session = state.sessions.find((entry) => entry.id === state.currentSessionId)
  const index = state.modal.createWorktree
    ? state.modal.targetWorktreeIndex
    : state.modal.selectedIndex
  return session?.worktrees?.[index]?.id
}

function launchAssistant(
  ctx: SideEffectContext,
  assistant: AssistantId,
  worktreeId?: string
): void {
  const { backend, clearStartupGrace, dispatch, startStartupGrace, state } = ctx
  const customCommand = state.customCommands[assistant]
  const tab = createTabSession(
    assistant,
    customCommand,
    state.customCommands,
    worktreeId ??
      getActiveWorktree(
        state.currentSessionId != null && state.currentSessionId !== ''
          ? state.sessions.find((s) => s.id === state.currentSessionId)
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
    getTabProjectPath(ctx, tab)
  )
}

async function launchAssistantInNewWorktree(
  ctx: SideEffectContext,
  assistant: AssistantId,
  worktreeName: string,
  branchName?: string,
  sourceWorktreeId?: string,
  templateId?: string
): Promise<void> {
  const sessionId = ctx.state.currentSessionId
  if (!(sessionId != null && sessionId !== '')) return
  const worktree = await createAimuxTempWorktree(
    ctx,
    sessionId,
    worktreeName,
    branchName,
    undefined,
    sourceWorktreeId
  )
  if (!worktree) return

  const template =
    templateId != null && templateId !== ''
      ? ctx.state.worktreeTemplates.find((entry) => entry.id === templateId)
      : undefined

  ctx.dispatch({ type: 'close-modal' })

  if (template) {
    applyWorktreeTemplate(ctx, template, worktree.id, worktree.path)
    ctx.dispatch({ focusMode: 'terminal-input', type: 'set-focus-mode' })
    return
  }

  const customCommand = ctx.state.customCommands[assistant]
  const tab = createTabSession(assistant, customCommand, ctx.state.customCommands, worktree.id)
  ctx.dispatch({ tab, type: 'add-tab' })
  ctx.dispatch({ focusMode: 'terminal-input', type: 'set-focus-mode' })
  startTabSession(
    ctx.backend,
    ctx.dispatch,
    ctx.clearStartupGrace,
    (tabId) => ctx.startStartupGrace(tabId, STARTUP_GRACE_MS),
    tab,
    ctx.state.layout.terminalCols,
    ctx.state.layout.terminalRows,
    worktree.path
  )
}

function applyWorktreeTemplate(
  ctx: SideEffectContext,
  template: WorktreeTemplate,
  worktreeId: string,
  worktreePath: string
): void {
  let firstTabId: string | null = null

  for (const templateTab of template.tabs) {
    const localToTabId = new Map<string, string>()

    for (let i = 0; i < templateTab.panes.length; i++) {
      const pane = templateTab.panes[i]
      if (!pane) continue
      const tab = createPaneTab(ctx, pane, worktreeId)
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
          worktreePath
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
        splitFromTab(ctx, splitFromId, direction, tab, worktreePath)
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

function createPaneTab(
  ctx: SideEffectContext,
  pane: WorktreeTemplatePane,
  worktreeId: string
): TabSession {
  // Accept `'shell'` as an alias for the registered `'terminal'` assistant so
  // template examples using the more intuitive name don't silently fall back
  // to Claude (createTabSession's unknown-id fallback resolves to index 0).
  const assistantId = (pane.assistant === 'shell' ? 'terminal' : pane.assistant) as AssistantId
  const customCommand = ctx.state.customCommands[assistantId]
  return createTabSession(assistantId, customCommand, ctx.state.customCommands, worktreeId)
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

function getTabProjectPath(
  ctx: SideEffectContext,
  tab: Pick<TabSession, 'worktreeId'>
): string | undefined {
  const session =
    ctx.state.currentSessionId != null && ctx.state.currentSessionId !== ''
      ? ctx.state.sessions.find((entry) => entry.id === ctx.state.currentSessionId)
      : undefined
  if (tab.worktreeId != null && tab.worktreeId !== '') {
    const worktree = session?.worktrees?.find((entry) => entry.id === tab.worktreeId)
    if (worktree) return worktree.path
  }
  return ctx.getCurrentSessionProjectPath()
}

function startExistingTab(ctx: SideEffectContext, tab: TabSession): void {
  const { backend, clearStartupGrace, dispatch, startStartupGrace, state } = ctx
  startTabSession(
    backend,
    dispatch,
    clearStartupGrace,
    (tabId) => startStartupGrace(tabId, STARTUP_GRACE_MS),
    tab,
    state.layout.terminalCols,
    state.layout.terminalRows,
    getTabProjectPath(ctx, tab)
  )
}

function executeSplitPane(
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

export function executeSideEffect(effect: SideEffect, ctx: SideEffectContext): void {
  const { backend, dispatch, state } = ctx

  switch (effect.type) {
    case 'quit': {
      saveCurrentWorkspace(effect.state)
      void backend.destroy(true)
      ctx.renderer.destroy()
      process.exit(0)
      return
    }
    case 'launch-selected-assistant': {
      if (
        state.modal.type === 'new-tab' &&
        state.modal.step === 'worktree-create' &&
        state.worktreeTemplates.length > 0
      ) {
        dispatch({ type: 'enter-new-tab-template-pick' })
        return
      }
      const option = getSelectedAssistantOption(state)
      if (state.modal.type === 'new-tab' && state.modal.createWorktree) {
        const worktreeName = state.modal.worktreeName
        const branchName = state.modal.branchName
        const sourceWorktreeId = getNewTabTargetWorktreeId(state)
        let templateId: string | undefined
        if (state.modal.step === 'template') {
          const templateIndex =
            state.modal.selectedIndex - getTemplateNoneOffset(state.modal.selectedAssistantId)
          if (templateIndex >= 0) {
            templateId = state.worktreeTemplates[templateIndex]?.id
          }
        }
        void (async () => {
          try {
            await enqueueGitOp(async () =>
              launchAssistantInNewWorktree(
                ctx,
                option.id,
                worktreeName,
                branchName,
                sourceWorktreeId,
                templateId
              )
            )
          } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error))
          }
        })()
        return
      }
      launchAssistant(ctx, option.id, getNewTabTargetWorktreeId(state))
      return
    }
    case 'edit-selected-assistant': {
      const option = getSelectedAssistantOption(state)
      dispatch({ assistantId: option.id, type: 'open-edit-custom-command' })
      return
    }
    case 'confirm-selected-session': {
      handleSessionSelection(ctx)
      return
    }
    case 'delete-selected-session': {
      handleSelectedSessionDelete(ctx)
      return
    }
    case 'delete-session': {
      handleDeleteSessionEffect(state, backend, dispatch, effect.sessionId)
      return
    }
    case 'delete-worktree': {
      void (async () => {
        try {
          await enqueueGitOp(async () =>
            runDeleteWorktree(
              { ...ctx, state: ctx.getState() },
              effect.sessionId,
              effect.worktreeId,
              !!(effect.force === true)
            )
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const forceable = isForceableWorktreeDeleteError(message)
          const latest = ctx.getState()
          if (latest.modal.type === 'new-tab' && latest.modal.step === 'worktree') {
            const session = latest.sessions.find((entry) => entry.id === effect.sessionId)
            const selected = session?.worktrees?.[latest.modal.selectedIndex]
            if (selected && selected.id !== effect.worktreeId) {
              ctx.dispatch({ message, type: 'git-mode-set-message' })
              return
            }
          }
          ctx.dispatch({
            confirmWorktreeId: forceable ? effect.worktreeId : null,
            message: forceable ? message : `Could not delete worktree: ${message}`,
            type: 'set-new-tab-worktree-delete-state',
          })
          ctx.dispatch({ message, type: 'git-mode-set-message' })
        }
      })()
      return
    }
    case 'move-worktree': {
      void (async () => {
        try {
          await enqueueGitOp(async () =>
            runMoveWorktree(
              { ...ctx, state: ctx.getState() },
              effect.sessionId,
              effect.sourceWorktreeId,
              effect.targetWorktreeId,
              effect.deleteSource === true
            )
          )
        } catch (error) {
          toast.error(error instanceof Error ? error.message : String(error))
        }
      })()
      return
    }
    case 'open-rename-selected-session': {
      openSelectedSessionRename(ctx)
      return
    }
    case 'create-session':
      handleCreateSessionEffect(state, dispatch, effect.name, effect.projectPath)
      return
    case 'close-tab': {
      ctx.clearIdleTimer(effect.tabId)
      ctx.clearStartupGrace(effect.tabId)
      backend.disposeSession(effect.tabId)
      return
    }
    case 'restart-tab':
      restartTabSession(
        backend,
        dispatch,
        ctx.clearIdleTimer,
        ctx.clearStartupGrace,
        (tab) => startExistingTab(ctx, tab),
        effect.tab
      )
      return
    case 'paste-selected-snippet': {
      pasteSnippetToTab(backend, state.activeTabId, ctx.activeTab, getSelectedSnippet(state))
      return
    }
    case 'paste-snippet-to-group': {
      pasteSnippetToActiveGroup(ctx)
      return
    }
    case 'edit-selected-snippet': {
      const snippet = getSelectedSnippet(state)
      if (snippet) {
        dispatch({ snippetId: snippet.id, type: 'open-snippet-editor' })
      }
      return
    }
    case 'delete-selected-snippet': {
      const snippet = getSelectedSnippet(state)
      if (snippet) {
        handleDeleteSnippetEffect(state.snippets, dispatch, snippet.id)
      }
      return
    }
    case 'save-snippet-editor': {
      handleSaveSnippetEditorEffect(state, dispatch)
      return
    }
    case 'save-custom-command': {
      saveCustomCommandSelection(ctx)
      return
    }
    case 'apply-theme': {
      applyThemeEffect(effect, ctx)
      return
    }
    case 'rename-session': {
      handleRenameSessionEffect(state.sessions, dispatch, effect.sessionId, effect.name)
      return
    }
    case 'split-pane': {
      const sourceTab =
        effect.sourceTabId != null && effect.sourceTabId !== ''
          ? state.tabs.find((t) => t.id === effect.sourceTabId)
          : undefined
      const assistant = sourceTab?.assistant ?? 'terminal'
      const customCommand = state.customCommands[assistant]
      const tab = createTabSession(
        assistant,
        customCommand,
        state.customCommands,
        sourceTab?.worktreeId
      )
      executeSplitPane(ctx, effect.direction, tab)
      return
    }
    case 'confirm-split': {
      confirmSplitSelection(ctx)
      return
    }
    case 'scroll-git-diff': {
      scrollGitDiff(effect.delta)
      return
    }
    case 'persist-git-diff-mode-ratio': {
      const config = loadConfig()
      const persistedGitPane = config.gitPane
      const paneRatio = persistedGitPane?.paneRatio ?? persistedGitPane?.ratio ?? 0.5
      const embeddedRatio = persistedGitPane?.embeddedRatio ?? persistedGitPane?.ratio ?? 0.5
      saveConfig({
        ...config,
        gitPane: {
          diffModeRatio: effect.ratio,
          embeddedRatio,
          fileListMode: persistedGitPane?.fileListMode,
          mode: persistedGitPane?.mode ?? 'embedded',
          paneRatio,
          position: persistedGitPane?.position ?? 'bottom',
          treeCompaction: persistedGitPane?.treeCompaction,
          visible: persistedGitPane?.visible ?? true,
        },
      })
      return
    }
    case 'persist-git-file-list-mode': {
      const config = loadConfig()
      const persistedGitPane = config.gitPane
      const paneRatio = persistedGitPane?.paneRatio ?? persistedGitPane?.ratio ?? 0.5
      const embeddedRatio = persistedGitPane?.embeddedRatio ?? persistedGitPane?.ratio ?? 0.5
      saveConfig({
        ...config,
        gitPane: {
          diffModeRatio: persistedGitPane?.diffModeRatio,
          embeddedRatio,
          fileListMode: effect.mode,
          mode: persistedGitPane?.mode ?? 'embedded',
          paneRatio,
          position: persistedGitPane?.position ?? 'bottom',
          treeCompaction: persistedGitPane?.treeCompaction,
          visible: persistedGitPane?.visible ?? true,
        },
      })
      return
    }
    case 'persist-git-tree-compaction': {
      const config = loadConfig()
      const persistedGitPane = config.gitPane
      const paneRatio = persistedGitPane?.paneRatio ?? persistedGitPane?.ratio ?? 0.5
      const embeddedRatio = persistedGitPane?.embeddedRatio ?? persistedGitPane?.ratio ?? 0.5
      saveConfig({
        ...config,
        gitPane: {
          diffModeRatio: persistedGitPane?.diffModeRatio,
          embeddedRatio,
          fileListMode: persistedGitPane?.fileListMode,
          mode: persistedGitPane?.mode ?? 'embedded',
          paneRatio,
          position: persistedGitPane?.position ?? 'bottom',
          treeCompaction: effect.enabled,
          visible: persistedGitPane?.visible ?? true,
        },
      })
      return
    }
    case 'git-stage': {
      void enqueueGitOp(async () => runGitAction(ctx, ['add', '--', effect.path], effect.path))
      return
    }
    case 'git-unstage': {
      void enqueueGitOp(async () =>
        runGitAction(ctx, ['restore', '--staged', '--', effect.path], effect.path)
      )
      return
    }
    case 'git-stage-all': {
      const paths = ctx.state.gitPanel.files.map((f) => f.path)
      void enqueueGitOp(async () => runGitActionAll(ctx, ['add', '-A'], paths))
      return
    }
    case 'git-unstage-all': {
      const paths = ctx.state.gitPanel.files.map((f) => f.path)
      void enqueueGitOp(async () => runGitActionAll(ctx, ['reset'], paths))
      return
    }
    case 'git-restore': {
      void enqueueGitOp(async () => runGitAction(ctx, ['restore', '--', effect.path], effect.path))
      return
    }
    case 'git-rm': {
      void enqueueGitOp(async () => runGitRm(ctx, effect.path))
      return
    }
    case 'git-commit': {
      const { body, title } = effect
      void enqueueGitOp(async () => runGitCommit(ctx, title, body))
      return
    }
    case 'git-commit-auto': {
      if (!isAutoCommitEnabled()) return
      const { body, title } = effect
      void enqueueGitOp(async () => runGitCommitAuto(ctx, title, body))
      return
    }
    case 'generate-auto-commit-now': {
      if (!isAutoCommitEnabled()) return
      void runGenerateAutoCommitNow(ctx, effect.sessionId)
      return
    }
    case 'git-push': {
      void enqueueGitOp(async () => runGitPush(ctx))
      return
    }
    case 'confirm-update-selection': {
      handleConfirmUpdateSelection(ctx)
      return
    }
    case 'switch-session-by-index': {
      handleSwitchSessionByIndex(ctx, effect.index, effect.worktreeId)
      return
    }
    case 'cycle-sidebar-item': {
      handleCycleSidebarItem(ctx, effect.direction)
      return
    }
    case 'switch-tab-by-index': {
      handleSwitchTabByIndex(ctx, effect.index)
      return
    }
    case 'toggle-transparent': {
      const next = !getTransparent()
      setTransparent(next)
      saveConfig({ ...loadConfig(), themeTransparent: next })
      return
    }
    case 'toggle-mode': {
      const next = getCurrentMode() === 'dark' ? 'light' : 'dark'
      setMode(next)
      saveConfig({ ...loadConfig(), themeMode: next })
      return
    }
    case 'open-file-in-editor': {
      openFileInEditor(ctx, effect.path)
      return
    }
    case 'open-selected-snippet-source-in-editor': {
      openSelectedSnippetSourceInEditor(ctx)
      return
    }
    default:
      effect satisfies never
  }
}

/**
 * Open the file backing the currently selected snippet in the user's editor.
 * Config-pinned snippets (id starts with `config:`) live in `aimux.config.ts`
 * (or `.js`); user-edited snippets live in `aimux-snippets.json`.
 *
 * On error (no editor, editor not in PATH) the failure is silent: there is no
 * snippet-picker status line. The user can check the debug log.
 */
function openSelectedSnippetSourceInEditor(ctx: SideEffectContext): void {
  const snippet = getSelectedSnippet(ctx.state)
  if (!snippet) return

  const configDir = getProfileConfigDir()
  let absolutePath: string

  if (isConfigSnippetId(snippet.id)) {
    const tsPath = joinPath(configDir, 'aimux.config.ts')
    const jsPath = joinPath(configDir, 'aimux.config.js')
    absolutePath = existsSync(jsPath) && !existsSync(tsPath) ? jsPath : tsPath
  } else {
    absolutePath = getSnippetsCatalogPath()
  }

  launchEditorOnFile(ctx, absolutePath, configDir, (message) => {
    logInputDebug('snippets.openInEditor.error', { message, path: absolutePath })
    ctx.dispatch({ message, type: 'snippet-picker-set-message' })
  })
}

function openFileInEditor(ctx: SideEffectContext, relPath: string): void {
  const fileEntry = ctx.state.gitPanel.files.find((f) => f.path === relPath)
  const cwd = fileEntry?.repoPath ?? ctx.getCurrentSessionProjectPath()
  if (!(cwd != null && cwd !== '')) {
    ctx.dispatch({ message: 'no working directory', type: 'git-mode-set-message' })
    return
  }
  const absolutePath = resolvePath(cwd, relPath)
  launchEditorOnFile(ctx, absolutePath, cwd, (message) =>
    ctx.dispatch({ message, type: 'git-mode-set-message' })
  )
}

function launchEditorOnFile(
  ctx: SideEffectContext,
  absolutePath: string,
  cwd: string,
  onError: (message: string) => void
): void {
  const config = getExternalEditorConfig()
  const rawCommand = config.command ?? process.env.VISUAL ?? process.env.EDITOR
  if (rawCommand == null || rawCommand === '' || rawCommand.trim() === '') {
    onError('no $EDITOR/$VISUAL set — configure externalEditor in aimux.config.ts')
    return
  }

  const cmdParts = shellSplit(rawCommand)
  const executable = cmdParts[0]
  if (!(executable != null && executable !== '')) {
    onError('invalid editor command')
    return
  }
  const baseName = executable.split('/').pop() ?? executable
  const extraCmdArgs = cmdParts.slice(1)

  const kind: 'gui' | 'tui' = config.kind ?? (KNOWN_GUI_EDITORS.has(baseName) ? 'gui' : 'tui')

  const templateArgs = config.args ?? DEFAULT_EDITOR_ARGS[baseName] ?? ['{file}']
  // No line target — let substitution strip `{line}` placeholders so we don't
  // defeat the editor's "restore last cursor position" feature.
  const resolvedArgs = [...extraCmdArgs, ...substituteEditorArgs(templateArgs, absolutePath)]

  if (!isCommandAvailable(executable)) {
    onError(`editor not found in PATH: ${executable}`)
    return
  }

  if (kind === 'gui') {
    spawnDetached(ctx, [executable, ...resolvedArgs], cwd)
    return
  }

  if (config.terminal && config.terminal.length > 0) {
    const shellCmd = buildShellCmd(cwd, executable, resolvedArgs)
    const argv = config.terminal.map((a) =>
      a.replaceAll('{cmd}', shellCmd).replaceAll('{cwd}', cwd)
    )
    spawnDetached(ctx, argv, cwd)
    return
  }

  void openEditorInline(ctx, executable, resolvedArgs, cwd)
}

/**
 * Substitute `{file}` and `{line}` placeholders in an editor-arg template.
 *
 * When `line` is `undefined` we drop the line bits cleanly so we don't pass a
 * misleading `:1` / `+1` that would defeat the editor's "restore last cursor
 * position" feature:
 *   `['--line', '{line}', '{file}']` → `['{file}']`
 *   `['+{line}', '{file}']`          → `['{file}']`
 *   `['-g', '{file}:{line}']`        → `['-g', '{file}']`
 *   `['{file}:{line}']`              → `['{file}']`
 */
function substituteEditorArgs(template: string[], file: string, line?: string): string[] {
  if (line !== undefined) {
    return template.map((a) => a.replaceAll('{file}', file).replaceAll('{line}', line))
  }
  const out: string[] = []
  for (let i = 0; i < template.length; i++) {
    const arg = template[i] ?? ''
    // Drop a flag immediately followed by a bare `{line}` arg (--line, -line, etc.).
    if (template[i + 1] === '{line}') {
      i++
      continue
    }
    // Drop standalone line tokens like `{line}`, `+{line}`, `:{line}`.
    if (/^[+:]?\{line\}$/.test(arg)) continue
    // Strip trailing `:{line}` or `+{line}` from compound tokens like `{file}:{line}`.
    out.push(arg.replaceAll(/[:+]\{line\}/g, '').replaceAll('{file}', file))
  }
  return out
}

function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`
}

/**
 * Minimal POSIX shell-word splitter — respects single/double quotes and
 * backslash escapes so values like `EDITOR='/Applications/My Editor/bin/code'`
 * or `EDITOR="code --user-data-dir \"/tmp/foo bar\""` tokenize correctly.
 * Does not expand variables or globs.
 */
function shellSplit(input: string): string[] {
  const out: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let hasToken = false
  for (let i = 0; i < input.length; i++) {
    const c = input[i] ?? ''
    if (!inSingle && !inDouble && /\s/.test(c)) {
      if (hasToken) {
        out.push(current)
        current = ''
        hasToken = false
      }
      continue
    }
    hasToken = true
    if (c === "'" && !inDouble) {
      inSingle = !inSingle
    } else if (c === '"' && !inSingle) {
      inDouble = !inDouble
    } else if (c === '\\' && !inSingle && i + 1 < input.length) {
      current += input[++i]
    } else {
      current += c
    }
  }
  if (hasToken) out.push(current)
  return out
}

function buildShellCmd(cwd: string, executable: string, args: string[]): string {
  const quoted = [executable, ...args].map(shellQuote).join(' ')
  return `cd ${shellQuote(cwd)} && ${quoted}`
}

function spawnDetached(ctx: SideEffectContext, argv: string[], cwd?: string): void {
  try {
    const child = Bun.spawn(argv, {
      cwd,
      stderr: 'pipe',
      stdin: 'ignore',
      stdout: 'ignore',
    })
    void (async () => {
      const stderr = await new Response(child.stderr).text()
      const code = await child.exited
      if (code !== 0) {
        const firstStderrLine = stderr.trim().split('\n')[0]
        const firstLine =
          firstStderrLine != null && firstStderrLine !== '' ? firstStderrLine : `exit ${code}`
        ctx.dispatch({ message: `editor: ${firstLine}`, type: 'git-mode-set-message' })
      }
    })()
    child.unref()
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'failed to spawn'
    ctx.dispatch({ message: `editor: ${msg}`, type: 'git-mode-set-message' })
  }
}

/**
 * Suspend the opentui renderer, hand the TTY to the editor (inheriting
 * stdin/stdout/stderr), then resume and force a redraw on exit. Matches the
 * shellout pattern used by opencode (packages/opencode/src/cli/cmd/tui/util/editor.ts).
 */
async function openEditorInline(
  ctx: SideEffectContext,
  executable: string,
  args: string[],
  cwd: string
): Promise<void> {
  const { renderer } = ctx
  try {
    renderer.suspend()
    renderer.currentRenderBuffer.clear()
    const proc = Bun.spawn([executable, ...args], {
      cwd,
      stderr: 'inherit',
      stdin: 'inherit',
      stdout: 'inherit',
    })
    await proc.exited
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'failed to spawn editor'
    ctx.dispatch({ message: `editor: ${msg}`, type: 'git-mode-set-message' })
  } finally {
    renderer.currentRenderBuffer.clear()
    renderer.resume()
    renderer.requestRender()
  }
}

function handleSwitchSessionByIndex(
  ctx: SideEffectContext,
  index: number,
  worktreeId?: string
): void {
  const { backend, dispatch } = ctx
  // Read fresh state. ctx.state is the snapshot from the previous render and
  // lags behind dispatches that happened in the same JS turn.
  const state = ctx.getState()
  const ordered = [...state.sessions].sort(
    (a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
  )
  const target = ordered[index - 1]
  if (!target) {
    logInputDebug('app.sessionBar.switchOutOfRange', { index, total: ordered.length })
    return
  }

  // Resolve which worktree to land on. If the caller passed an explicit
  // `worktreeId` (workspace-row tap → its primary, worktree-row tap → that
  // worktree), honor it; otherwise let the target session keep its persisted
  // activeWorktreeId.
  const resolvedWorktreeId =
    worktreeId != null &&
    worktreeId !== '' &&
    (target.worktrees?.some((w) => w.id === worktreeId) ?? false)
      ? worktreeId
      : undefined
  const needsWorktreeChange =
    resolvedWorktreeId != null && resolvedWorktreeId !== target.activeWorktreeId

  if (target.id === state.currentSessionId) {
    if (needsWorktreeChange) {
      dispatch({
        sessionId: target.id,
        type: 'set-active-worktree',
        worktreeId: resolvedWorktreeId,
      })
    }
    if (state.focusMode === 'git') {
      dispatch({ type: 'exit-git-mode' })
    }
    return
  }

  // Cross-workspace: bundle the worktree change into the session record AND
  // fold set-sessions + load-session into a SINGLE setState call. Otherwise
  // any subscriber notification (re-render, useEffect, backend re-attach)
  // between dispatches can re-assert the session's previously-persisted
  // activeWorktreeId, dropping the user back on the last-visited worktree.
  const patchedSession = needsWorktreeChange
    ? withActiveWorktree(target, resolvedWorktreeId)
    : target
  const patchedState: AppState = needsWorktreeChange
    ? {
        ...state,
        sessions: state.sessions.map((s) => (s.id === patchedSession.id ? patchedSession : s)),
      }
    : state
  const sessions = switchSessionRecords(patchedState, patchedSession)
  saveSessionCatalog(sessions)
  void backend.destroy(true)
  appStore.setState((current) => {
    const afterSet = appReducer(current, { sessions, type: 'set-sessions' })
    return appReducer(afterSet, {
      forceDisconnected: false,
      sessionId: patchedSession.id,
      type: 'load-session',
      workspaceSnapshot: patchedSession.workspaceSnapshot,
    })
  })
}

interface SidebarItem {
  sessionId: string
  worktreeId: string | null
}

function buildSidebarItems(state: AppState): SidebarItem[] {
  const ordered = [...state.sessions].sort(
    (a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
  )
  const items: SidebarItem[] = []
  for (const session of ordered) {
    items.push({ sessionId: session.id, worktreeId: null })
    const worktrees = session.worktrees ?? []
    const primary = worktrees.find((w) => w.source === 'primary') ?? worktrees[0]
    for (const wt of worktrees) {
      if (wt.id === primary?.id) continue
      items.push({ sessionId: session.id, worktreeId: wt.id })
    }
  }
  return items
}

function findCurrentSidebarItem(state: AppState, items: SidebarItem[]): number {
  const sessionId = state.currentSessionId
  if (sessionId == null || sessionId === '') return -1
  const session = state.sessions.find((s) => s.id === sessionId)
  const worktrees = session?.worktrees ?? []
  const primary = worktrees.find((w) => w.source === 'primary') ?? worktrees[0]
  const activeWtId = session?.activeWorktreeId ?? null
  // The workspace row IS the primary worktree (no separate row), so an active
  // primary or undefined active maps to the workspace-item.
  const targetWorktreeId = activeWtId == null || activeWtId === primary?.id ? null : activeWtId
  return items.findIndex(
    (item) => item.sessionId === sessionId && item.worktreeId === targetWorktreeId
  )
}

function handleCycleSidebarItem(ctx: SideEffectContext, direction: 1 | -1): void {
  const { backend, dispatch } = ctx
  // Read fresh from the store, not ctx.state (which is a per-render
  // snapshot). Rapid key presses fire before React re-renders, so ctx.state
  // can lag the actual store.
  const state = appStore.getState()
  const items = buildSidebarItems(state)
  if (items.length === 0) return
  const currentIdx = findCurrentSidebarItem(state, items)
  // If we don't know the current, jump to first/last depending on direction.
  let startIdx: number
  if (currentIdx >= 0) {
    startIdx = currentIdx
  } else {
    startIdx = direction === 1 ? -1 : 0
  }
  const len = items.length
  const target = items[(((startIdx + direction) % len) + len) % len]
  if (!target) return

  const session = state.sessions.find((s) => s.id === target.sessionId)
  if (!session) return

  // Determine the worktree to activate. For workspace-items, that's the
  // primary; for worktree-items, the specific worktree.
  const worktrees = session.worktrees ?? []
  const primary = worktrees.find((w) => w.source === 'primary') ?? worktrees[0]
  const targetWorktreeId = target.worktreeId ?? primary?.id

  const isCrossWorkspace = session.id !== state.currentSessionId
  const needsWorktreeChange =
    targetWorktreeId != null && targetWorktreeId !== session.activeWorktreeId

  if (isCrossWorkspace) {
    // Bundle the worktree change into the session record AND fold the
    // session switch's two dispatches (set-sessions + load-session) into a
    // SINGLE Zustand setState call — otherwise each dispatch fires a
    // separate subscription notification and the @opentui/react reconciler
    // paints an intermediate frame where the new session is current but
    // the old activeWorktreeId still holds, producing the visible flicker.
    const patchedSession = needsWorktreeChange
      ? withActiveWorktree(session, targetWorktreeId)
      : session
    const patchedState: AppState = needsWorktreeChange
      ? {
          ...state,
          sessions: state.sessions.map((s) => (s.id === patchedSession.id ? patchedSession : s)),
        }
      : state
    const sessions = switchSessionRecords(patchedState, patchedSession)
    saveSessionCatalog(sessions)
    void backend.destroy(true)
    appStore.setState((current) => {
      const afterSet = appReducer(current, { sessions, type: 'set-sessions' })
      return appReducer(afterSet, {
        // Daemon is alive and attach() will hydrate real statuses within a
        // frame, so skip the snapshot's running→disconnected downgrade —
        // otherwise the "Restored snapshot" hint flashes on every j/k cycle.
        forceDisconnected: false,
        sessionId: patchedSession.id,
        type: 'load-session',
        workspaceSnapshot: patchedSession.workspaceSnapshot,
      })
    })
    return
  }

  if (needsWorktreeChange) {
    dispatch({
      sessionId: session.id,
      type: 'set-active-worktree',
      worktreeId: targetWorktreeId,
    })
  }
}

function handleSwitchTabByIndex(ctx: SideEffectContext, index: number): void {
  const { dispatch, state } = ctx
  const currentSession =
    state.currentSessionId != null && state.currentSessionId !== ''
      ? state.sessions.find((s) => s.id === state.currentSessionId)
      : undefined
  const visible = filterTabsForActiveWorktree(state.tabs, currentSession)
  const entries = buildTabEntries(visible, state.layoutTrees, state.tabGroupMap, state.activeTabId)
  const target = entries[index - 1]
  if (!target) {
    logInputDebug('app.tabBar.switchOutOfRange', { index, total: entries.length })
    return
  }
  const targetTabId = target.kind === 'single' ? target.tab.id : target.activeLeafId
  if (targetTabId === state.activeTabId) return
  dispatch({ tabId: targetTabId, type: 'set-active-tab' })
}

function replaceSession(
  state: AppState,
  sessionId: string,
  next: (session: AppState['sessions'][number]) => AppState['sessions'][number]
): AppState['sessions'] {
  return state.sessions.map((session) => (session.id === sessionId ? next(session) : session))
}

function handleSwitchWorktree(ctx: SideEffectContext, sessionId: string, worktreeId: string): void {
  const session = ctx.state.sessions.find((entry) => entry.id === sessionId)
  const worktree = session?.worktrees?.find((entry) => entry.id === worktreeId)
  if (!session || !worktree) return
  const sessions = replaceSession(ctx.state, sessionId, (entry) => ({
    ...entry,
    activeWorktreeId: worktreeId,
    projectPath: worktree.path,
    updatedAt: new Date().toISOString(),
  }))
  saveSessionCatalog(sessions)
  ctx.dispatch({ sessions, type: 'set-sessions' })
}

function normalizeBranchName(branch: string | undefined): string | undefined {
  return branch?.replace(/^refs\/heads\//, '').trim()
}

async function createAimuxTempWorktree(
  ctx: SideEffectContext,
  sessionId: string,
  requestedName?: string,
  requestedBranchName?: string,
  requestedBaseRef?: string,
  sourceWorktreeId?: string
): Promise<WorktreeRecord | undefined> {
  const session = ctx.state.sessions.find((entry) => entry.id === sessionId)
  const source =
    session?.worktrees?.find((entry) => entry.id === sourceWorktreeId) ?? getActiveWorktree(session)
  const sourcePath = source?.path ?? getSessionProjectPath(session)
  if (!session || !(sourcePath != null && sourcePath !== '')) return undefined

  // Resolve the *main* repo checkout, never the active linked worktree, so the
  // record's repoRoot stays valid after sibling worktrees are deleted.
  const repoRoot = (await getMainWorktreeRoot(sourcePath)) ?? source?.repoRoot ?? sourcePath
  const baseBranch = (await getCurrentBranch(sourcePath)) ?? source?.branch ?? 'HEAD'
  const baseRef = requestedBaseRef ?? baseBranch
  const worktreeId = createPrefixedId('worktree')
  const trimmedName = requestedName?.trim()
  const worktreeName =
    trimmedName != null && trimmedName !== ''
      ? trimmedName
      : `wt-${sanitizePathSegment(session.name, 12)}`
  const trimmedBranch = requestedBranchName?.trim()
  const branchName =
    trimmedBranch != null && trimmedBranch !== ''
      ? trimmedBranch
      : `aimux/${sanitizePathSegment(worktreeName, 40)}-${Date.now().toString(36)}`
  const targetPath = makeWorktreePath({ repoRoot, worktreeId, worktreeName })

  const existingWorktree = (await listGitWorktrees(repoRoot)).find(
    (entry) =>
      entry.prunable !== true &&
      normalizeBranchName(entry.branch) === normalizeBranchName(branchName)
  )
  if (existingWorktree) {
    ctx.dispatch({
      message: `Branch already checked out in another worktree: ${existingWorktree.path}`,
      type: 'set-new-tab-branch-error',
    })
    return undefined
  }

  await mkdir(dirname(targetPath), { recursive: true })
  await assertSafeAimuxWorktreePath(targetPath)
  await createGitWorktree({ baseRef, branchName, repoPath: repoRoot, targetPath })
  const now = new Date().toISOString()

  const worktree: WorktreeRecord = {
    baseRef,
    branch: branchName,
    commitSha: await getHeadSha(targetPath),
    createdAt: now,
    createdByAimux: true,
    id: worktreeId,
    name: worktreeName,
    path: targetPath,
    repoRoot,
    source: 'aimux-temp',
    updatedAt: now,
  }
  const sessions = replaceSession(ctx.state, sessionId, (entry) => ({
    ...entry,
    activeWorktreeId: worktree.id,
    projectPath: worktree.path,
    updatedAt: now,
    worktrees: [...(entry.worktrees ?? []), worktree],
  }))
  saveSessionCatalog(sessions)
  ctx.dispatch({ sessions, type: 'set-sessions' })
  toast.success(`Created worktree ${branchName}`)
  return worktree
}

// Dispose and close every tab pinned to a worktree (timers, pty session, state).
function disposeWorktreeTabs(ctx: SideEffectContext, worktreeId: string): void {
  for (const tab of ctx.state.tabs.filter((entry) => entry.worktreeId === worktreeId)) {
    ctx.clearIdleTimer(tab.id)
    ctx.clearStartupGrace(tab.id)
    ctx.backend.disposeSession(tab.id)
    ctx.dispatch({ tabId: tab.id, type: 'close-tab' })
  }
}

async function runDeleteWorktree(
  ctx: SideEffectContext,
  sessionId: string,
  worktreeId: string,
  force: boolean
): Promise<void> {
  const session = ctx.state.sessions.find((entry) => entry.id === sessionId)
  const worktree = session?.worktrees?.find((entry) => entry.id === worktreeId)
  if (!session) throw new Error('session not found')
  if (!worktree) throw new Error('worktree not found')
  if ((session.worktrees?.length ?? 0) <= 1) throw new Error('at least one worktree must remain')
  if (worktree.source === 'primary') throw new Error('root worktree cannot be deleted')

  const tabsInWorktree = ctx.state.tabs.filter((tab) => tab.worktreeId === worktreeId)
  if (tabsInWorktree.length > 0 && !force) {
    throw new ActiveWorktreeTabsError(tabsInWorktree.length)
  }
  disposeWorktreeTabs(ctx, worktreeId)

  if (
    worktree.source === 'aimux-temp' &&
    worktree.createdByAimux &&
    isInsideAimuxWorktreeRoot(worktree.path) &&
    !existsSync(worktree.path)
  ) {
    removeWorktreeRecordFromSession(ctx, sessionId, session, worktreeId)
    return
  }

  if (
    worktree.source === 'aimux-temp' &&
    worktree.createdByAimux &&
    isInsideAimuxWorktreeRoot(worktree.path)
  ) {
    await assertSafeAimuxWorktreePath(worktree.path)
    await removeGitWorktree({
      force,
      repoPath: resolveWorktreeGitDir(session, worktree),
      targetPath: worktree.path,
    })
  } else if (worktree.source === 'aimux-temp' || worktree.createdByAimux) {
    throw new Error(`refusing unsafe worktree delete: ${worktree.path}`)
  }

  removeWorktreeRecordFromSession(ctx, sessionId, session, worktreeId)
}

// A worktree's stored repoRoot can point at a sibling worktree that was since
// deleted. Git commands only need *some* existing worktree of the repo (they
// share the common git dir), so fall back to the main checkout or any live
// worktree path rather than letting `git -C` fail on a vanished directory.
function resolveWorktreeGitDir(
  session: NonNullable<SideEffectContext['state']['sessions'][number]>,
  worktree: WorktreeRecord
): string {
  const candidates = [
    session.worktrees?.find((entry) => entry.source === 'primary')?.path,
    worktree.repoRoot,
    ...(session.worktrees ?? [])
      .filter((entry) => entry.id !== worktree.id)
      .map((entry) => entry.path),
  ]
  return candidates.find((path) => path !== undefined && existsSync(path)) ?? worktree.repoRoot
}

async function runMoveWorktree(
  ctx: SideEffectContext,
  sessionId: string,
  sourceWorktreeId: string,
  targetWorktreeId: string,
  deleteSource: boolean
): Promise<void> {
  const session = ctx.state.sessions.find((entry) => entry.id === sessionId)
  const source = session?.worktrees?.find((entry) => entry.id === sourceWorktreeId)
  const target = session?.worktrees?.find((entry) => entry.id === targetWorktreeId)
  if (!session) throw new Error('session not found')
  if (!source || !target) throw new Error('worktree not found')
  if (source.id === target.id) throw new Error('source and target are the same worktree')
  if (source.branch == null || source.branch === '') {
    throw new Error('source worktree has no branch to move')
  }
  if (deleteSource && source.source === 'primary') {
    throw new Error('the primary worktree cannot be deleted')
  }

  const sourceLabel = source.branch ?? source.name
  const targetLabel = target.branch ?? target.name
  const result = await moveWorktree({
    sourceBranch: source.branch,
    sourcePath: source.path,
    targetPath: target.path,
  })

  // Toasts surface the outcome everywhere — the picker can be opened outside git
  // mode (from a tab menu), where the git-pane message would never be seen.
  if (result.kind === 'dirty-target') {
    toast.warning(`Target ${targetLabel} has uncommitted changes — commit or stash it first`)
    return
  }
  if (result.kind === 'conflict') {
    toast.warning(
      `Move hit conflicts in ${result.files.length} file(s) — left ${sourceLabel} untouched`
    )
    return
  }
  if (result.kind === 'error') {
    toast.error(`Move failed: ${result.message}`)
    return
  }

  // Land on the target. When deleting the source, close its terminals and
  // switch to the target up front, synchronously, BEFORE the slow
  // `git worktree remove`. Closing the source's active tab re-syncs the active
  // worktree to a default tab (withActiveTabWorktree); doing the close+switch in
  // one batch lands on the target with no intermediate render, so the removal
  // runs with the target already active instead of flashing/sticking to a
  // default worktree. Re-read state each step so we never resurrect the source.
  if (deleteSource) {
    disposeWorktreeTabs({ ...ctx, state: ctx.getState() }, sourceWorktreeId)
    handleSwitchWorktree({ ...ctx, state: ctx.getState() }, sessionId, targetWorktreeId)
    await runDeleteWorktree({ ...ctx, state: ctx.getState() }, sessionId, sourceWorktreeId, true)
  } else {
    handleSwitchWorktree({ ...ctx, state: ctx.getState() }, sessionId, targetWorktreeId)
  }
  toast.success(
    `Moved ${sourceLabel} → ${targetLabel} · ${result.filesChanged} file(s) staged — review & commit`
  )
}

function removeWorktreeRecordFromSession(
  ctx: SideEffectContext,
  sessionId: string,
  session: NonNullable<SideEffectContext['state']['sessions'][number]>,
  worktreeId: string
): void {
  const remaining = (session.worktrees ?? []).filter((entry) => entry.id !== worktreeId)
  const nextActive =
    session.activeWorktreeId === worktreeId ? remaining[0] : getActiveWorktree(session)
  const sessions = replaceSession(ctx.state, sessionId, (entry) => ({
    ...entry,
    activeWorktreeId: nextActive?.id,
    projectPath: nextActive?.path ?? entry.projectPath,
    updatedAt: new Date().toISOString(),
    workspaceSnapshot: pruneSnapshotOfWorktree(entry.workspaceSnapshot, worktreeId),
    worktrees: remaining,
  }))
  saveSessionCatalog(sessions)
  ctx.dispatch({ sessions, type: 'set-sessions' })
  if (ctx.state.modal.type === 'new-tab' && ctx.state.modal.step === 'worktree') {
    ctx.dispatch({
      index: Math.min(ctx.state.modal.selectedIndex, Math.max(0, remaining.length - 1)),
      type: 'set-modal-selection-index',
    })
  }
  ctx.dispatch({ message: null, type: 'set-new-tab-worktree-delete-state' })
}

function isForceableWorktreeDeleteError(message: string): boolean {
  return /active assistant tabs|dirty|uncommitted|modified|untracked|not clean|contains.*changes/i.test(
    message
  )
}

class ActiveWorktreeTabsError extends Error {
  constructor(tabCount: number) {
    super(
      `active assistant tabs are using this worktree (${tabCount}). Click [del] again to close them and delete the worktree.`
    )
  }
}

function handleConfirmUpdateSelection(ctx: SideEffectContext): void {
  const { state } = ctx
  if (state.modal.type !== 'update-available') {
    return
  }
  const latest = state.modal.latestVersion
  if (state.modal.selectedIndex === 0) {
    runUpdateFromTui(ctx, latest)
    return
  }
  saveConfig({ ...loadConfig(), skippedUpdateVersion: latest })
}

function runUpdateFromTui(ctx: SideEffectContext, latestVersion: string): void {
  saveCurrentWorkspace(ctx.state)
  void ctx.backend.destroy(true)
  ctx.renderer.destroy()
  process.stdout.write(`\nUpdating aimux to ${latestVersion}...\n`)
  const proc = Bun.spawn(['bun', 'update', '-g', '@brimveyn/aimux', '@brimveyn/aimux-config'], {
    stderr: 'inherit',
    stdin: 'inherit',
    stdout: 'inherit',
  })
  void (async () => {
    const code = await proc.exited
    if (code === 0) {
      process.stdout.write(`\nUpdated. Run \`aimux\` to start the new version.\n`)
    } else {
      process.stderr.write(`\nUpdate failed (exit code ${code}).\n`)
    }
    process.exit(code ?? 1)
  })()
}

async function runGitAction(
  ctx: SideEffectContext,
  args: string[],
  pathToInvalidate?: string
): Promise<void> {
  const fallback = ctx.getCurrentSessionProjectPath()
  const repoPath =
    pathToInvalidate != null && pathToInvalidate !== ''
      ? ctx.state.gitPanel.files.find((f) => f.path === pathToInvalidate)?.repoPath
      : undefined
  const cwd = repoPath ?? fallback
  if (!(cwd != null && cwd !== '')) return
  const result = await $`git -C ${cwd} ${args}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim()
    ctx.dispatch({ message: stderr || 'git action failed', type: 'git-mode-set-message' })
    return
  }
  ctx.dispatch({ message: null, type: 'git-mode-set-message' })
  if (pathToInvalidate != null && pathToInvalidate !== '') {
    ctx.dispatch({ path: pathToInvalidate, type: 'git-mode-clear-diff-cache' })
  }
}

async function runGitActionAll(
  ctx: SideEffectContext,
  args: string[],
  pathsToInvalidate: string[]
): Promise<void> {
  const cwd = ctx.getCurrentSessionProjectPath()
  if (!(cwd != null && cwd !== '')) return
  const result = await $`git -C ${cwd} ${args}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim()
    ctx.dispatch({ message: stderr || 'git action failed', type: 'git-mode-set-message' })
    return
  }
  ctx.dispatch({ message: null, type: 'git-mode-set-message' })
  if (pathsToInvalidate.length > 0) {
    ctx.dispatch({ paths: pathsToInvalidate, type: 'git-mode-invalidate-diffs' })
  }
}

async function runGitRm(ctx: SideEffectContext, path: string): Promise<void> {
  const repoPath = ctx.state.gitPanel.files.find((f) => f.path === path)?.repoPath
  const cwd = repoPath ?? ctx.getCurrentSessionProjectPath()
  if (!(cwd != null && cwd !== '')) return
  const absolute = `${cwd}/${path}`
  try {
    const stat = await Bun.file(absolute).stat()
    await (stat.isDirectory()
      ? Bun.$`rm -rf -- ${absolute}`.quiet().nothrow()
      : Bun.file(absolute).unlink())
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed to delete file'
    ctx.dispatch({ message, type: 'git-mode-set-message' })
    return
  }
  ctx.dispatch({ message: null, type: 'git-mode-set-message' })
  ctx.dispatch({ path, type: 'git-mode-clear-diff-cache' })
}

async function runGitCommit(ctx: SideEffectContext, title: string, body: string): Promise<void> {
  const cwd = ctx.getCurrentSessionProjectPath()
  if (!(cwd != null && cwd !== '')) return
  if (!title) {
    ctx.dispatch({ message: 'empty commit title', type: 'git-mode-set-message' })
    return
  }
  const result = body
    ? await $`git -C ${cwd} commit -m ${title} -m ${body}`.quiet().nothrow()
    : await $`git -C ${cwd} commit -m ${title}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim()
    ctx.dispatch({ message: null, type: 'git-mode-set-message' })
    toast.error(stderr || 'Commit failed')
    return
  }
  clearAutoCommitForCurrentSession(ctx)
  // Match the push flow: clear any inline git-pane message and surface the
  // result as a toast so it's seen even after leaving git mode.
  ctx.dispatch({ message: null, type: 'git-mode-set-message' })
  toast.success(`Committed: ${title}`)
}

async function runGitCommitAuto(
  ctx: SideEffectContext,
  title: string,
  body: string
): Promise<void> {
  if (!title) {
    ctx.dispatch({ message: 'empty commit title', type: 'git-mode-set-message' })
    return
  }
  const cwd = ctx.getCurrentSessionProjectPath()
  if (!(cwd != null && cwd !== '')) return

  // If the user has manually staged files, respect that intent and commit
  // only the staged set — don't run `git add -A` which would sweep up
  // unrelated unstaged/untracked changes. With nothing staged, `add -A`
  // keeps the "commit everything" behaviour the user expects from auto-commit.
  const hasStaged = ctx.state.gitPanel.files.some((f) => f.section === 'staged')
  if (!hasStaged) {
    const addArgs = ['add', '-A']
    const addResult = await $`git -C ${cwd} ${addArgs}`.quiet().nothrow()
    if (addResult.exitCode !== 0) {
      ctx.dispatch({ message: null, type: 'git-mode-set-message' })
      toast.error(addResult.stderr.toString().trim() || 'Auto-commit: git add failed')
      return
    }
  }

  const commitResult = body
    ? await $`git -C ${cwd} commit -m ${title} -m ${body}`.quiet().nothrow()
    : await $`git -C ${cwd} commit -m ${title}`.quiet().nothrow()

  if (commitResult.exitCode !== 0) {
    ctx.dispatch({ message: null, type: 'git-mode-set-message' })
    toast.error(commitResult.stderr.toString().trim() || 'Auto-commit: commit failed')
    return
  }

  clearAutoCommitForCurrentSession(ctx)
  ctx.dispatch({ message: `committed: ${title}`, type: 'git-mode-set-message' })
}

function clearAutoCommitForCurrentSession(ctx: SideEffectContext): void {
  const sessionId = ctx.state.currentSessionId
  if (!(sessionId != null && sessionId !== '')) return
  ctx.dispatch({ sessionId, type: 'auto-commit-clear' })
}

async function runGenerateAutoCommitNow(ctx: SideEffectContext, sessionId: string): Promise<void> {
  const session = ctx.state.sessions.find((s) => s.id === sessionId)
  const panel = ctx.state.gitPanel
  if (panel.error !== null) {
    toast.warning('Auto-commit: git panel unavailable')
    ctx.dispatch({ sessionId, type: 'auto-commit-clear' })
    return
  }
  const tab = ctx.activeTab
  if (!tab) {
    toast.warning('Auto-commit: no active assistant tab — open a claude/codex session first')
    ctx.dispatch({ sessionId, type: 'auto-commit-clear' })
    return
  }
  await triggerAutoCommitNow({
    assistant: tab.assistant,
    git: {
      ahead: panel.ahead,
      behind: panel.behind,
      branch: panel.branch,
      files: panel.files,
    },
    projectPath: session?.projectPath,
    sessionId,
    tabId: tab.id,
  })
}

async function runGitPush(ctx: SideEffectContext): Promise<void> {
  const cwd = ctx.getCurrentSessionProjectPath()
  if (!(cwd != null && cwd !== '')) return
  ctx.dispatch({ message: 'pushing…', type: 'git-mode-set-message' })

  const upstream = await $`git -C ${cwd} rev-parse --abbrev-ref --symbolic-full-name @{u}`
    .quiet()
    .nothrow()
  const hasUpstream = upstream.exitCode === 0

  const result = hasUpstream
    ? await $`git -C ${cwd} push`.quiet().nothrow()
    : await $`git -C ${cwd} push --set-upstream origin HEAD`.quiet().nothrow()

  // Clear the inline "pushing…" progress; surface the result as a toast so it's
  // visible even after leaving git mode (and so push failures aren't missed).
  ctx.dispatch({ message: null, type: 'git-mode-set-message' })
  if (result.exitCode !== 0) {
    toast.error(result.stderr.toString().trim() || 'Push failed')
    return
  }
  toast.success('Pushed')
}
