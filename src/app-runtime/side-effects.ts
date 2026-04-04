import type { SideEffect } from '../input/modes/types'
import type { SessionBackend } from '../session-backend/types'
import type { AppAction, AppState, AssistantId, TabSession } from '../state/types'

import { loadConfig, saveConfig } from '../config'
import { logInputDebug } from '../debug/input-log'
import { createPrefixedId } from '../platform/id'
import {
  getAllAssistantOptions,
  getAssistantOption,
  isCommandAvailable,
  parseCommand,
} from '../pty/command-registry'
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
import { filterSessions, filterSnippets } from '../state/selectors'
import { createDefaultTerminalModes } from '../state/terminal-modes'
import { saveCurrentWorkspace } from '../state/workspace-save'
import { applyTheme } from '../ui/theme'
import { THEME_IDS, type ThemeId } from '../ui/themes'
import {
  handleCreateSessionEffect,
  handleDeleteSessionEffect,
  handleRenameSessionEffect,
  handleSwitchSessionEffect,
  restartTabSession,
} from './session-actions'
import {
  handleDeleteSnippetEffect,
  handleSaveSnippetEditorEffect,
  pasteSnippetToTab,
} from './snippet-actions'

const STARTUP_GRACE_MS = 5_000

export interface SideEffectContext {
  state: AppState
  dispatch: (action: AppAction) => void
  backend: SessionBackend
  renderer: { destroy(): void }
  themeId: ThemeId
  setThemeId: (id: ThemeId) => void
  activeTab: TabSession | undefined
  clearIdleTimer: (tabId: string) => void
  clearStartupGrace: (tabId: string) => void
  startStartupGrace: (tabId: string, timeoutMs: number) => void
  getCurrentSessionProjectPath: () => string | undefined
}

function getSelectedAssistantOption(state: AppState) {
  return (
    getAllAssistantOptions(state.customCommands)[state.modal.selectedIndex] ?? getAssistantOption(0)
  )
}

function handleSessionSelection(ctx: SideEffectContext): void {
  const { state, dispatch, backend } = ctx
  const selectedSession = getSelectedSession(state)
  logInputDebug('app.sessionPicker.confirm', {
    selectedIndex: state.modal.selectedIndex,
    selectedSessionId: selectedSession?.id ?? null,
    creatingNew: !selectedSession,
  })

  if (selectedSession) {
    handleSwitchSessionEffect(state, backend, dispatch, selectedSession)
    return
  }

  dispatch({ type: 'open-create-session-modal' })
}

function handleSelectedSessionDelete(ctx: SideEffectContext): void {
  const { state, dispatch, backend } = ctx
  const selectedSession = getSelectedSession(state)
  logInputDebug('app.sessionPicker.deleteSelected', {
    selectedIndex: state.modal.selectedIndex,
    selectedSessionId: selectedSession?.id ?? null,
  })

  if (selectedSession) {
    handleDeleteSessionEffect(state, backend, dispatch, selectedSession.id)
  }
}

function openSelectedSessionRename(ctx: SideEffectContext): void {
  const { state, dispatch } = ctx
  const selectedSession = getSelectedSession(state)
  if (!selectedSession) {
    return
  }

  logInputDebug('app.sessionPicker.openRenameModal', {
    selectedIndex: state.modal.selectedIndex,
    selectedSessionId: selectedSession.id,
  })
  dispatch({
    type: 'open-session-name-modal',
    sessionTargetId: selectedSession.id,
    initialName: selectedSession.name,
  })
}

function pasteSnippetToActiveGroup(ctx: SideEffectContext): void {
  const { state, backend, activeTab } = ctx
  const snippet = getSelectedSnippet(state)
  if (!snippet || !state.activeTabId) {
    return
  }

  const groupId = getGroupIdForTab(state.tabGroupMap, state.activeTabId)
  const groupTree = groupId ? state.layoutTrees[groupId] : null
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

function saveCustomCommandSelection(state: AppState): void {
  const option = getAllAssistantOptions(state.customCommands)[state.modal.selectedIndex]
  if (!option || state.modal.editBuffer === null) {
    return
  }

  const trimmed = state.modal.editBuffer.trim()
  const newCustomCommands = { ...state.customCommands }
  if (trimmed) {
    newCustomCommands[option.id] = trimmed
  } else {
    delete newCustomCommands[option.id]
  }

  saveConfig({
    ...loadConfig(),
    customCommands: newCustomCommands,
  })
}

function applyThemeEffect(
  effect: Extract<SideEffect, { type: 'apply-theme' }>,
  ctx: SideEffectContext
): void {
  const { state } = ctx

  switch (effect.action) {
    case 'open':
      applyTheme(THEME_IDS[0] ?? 'aimux')
      return
    case 'restore':
      applyTheme(ctx.themeId)
      return
    case 'confirm': {
      const selectedId = THEME_IDS[state.modal.selectedIndex]
      if (selectedId) {
        applyTheme(selectedId)
        ctx.setThemeId(selectedId)
        saveConfig({ ...loadConfig(), themeId: selectedId })
      }
      return
    }
    case 'preview': {
      const count = THEME_IDS.length
      const nextIndex = (state.modal.selectedIndex + effect.delta + count) % count
      const previewId = THEME_IDS[nextIndex]
      if (previewId) {
        applyTheme(previewId)
      }
      return
    }
  }
}

function confirmSplitSelection(ctx: SideEffectContext): void {
  const { state, dispatch } = ctx
  const option = getSelectedAssistantOption(state)
  const direction = state.modal.type === 'split-picker' ? state.modal.splitDirection : 'vertical'
  const customCommand = state.customCommands[option.id]
  const tab = createTabSession(option.id, customCommand, state.customCommands)
  dispatch({ type: 'close-modal' })
  executeSplitPane(ctx, direction, tab)
  dispatch({ type: 'set-focus-mode', focusMode: 'terminal-input' })
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
  customCommands?: Record<string, string>
): TabSession {
  const allOptions = getAllAssistantOptions(customCommands ?? {})
  const option = allOptions.find((o) => o.id === assistant) ?? getAssistantOption(0)

  return {
    id: createTabId(),
    assistant,
    title: option.label,
    status: 'starting',
    activity: 'idle',
    buffer: '',
    terminalModes: createDefaultTerminalModes(),
    command: customCommand ?? option.command,
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
  startStartupGrace(tab.id)

  const { executable, args } = parseCommand(tab.command)

  if (!isCommandAvailable(executable)) {
    clearStartupGrace(tab.id)
    dispatch({
      type: 'set-tab-error',
      tabId: tab.id,
      message: `[command not found] ${executable} is not available in PATH.`,
    })
    return
  }

  backend.createSession({
    tabId: tab.id,
    assistant: tab.assistant,
    title: tab.title,
    command: executable,
    args,
    cols,
    rows,
    cwd,
  })
}

function launchAssistant(ctx: SideEffectContext, assistant: AssistantId): void {
  const { state, dispatch, backend, clearStartupGrace, startStartupGrace } = ctx
  const customCommand = state.customCommands[assistant]
  const tab = createTabSession(assistant, customCommand, state.customCommands)
  logInputDebug('app.launchAssistant', {
    assistant,
    tabId: tab.id,
    command: tab.command,
  })
  dispatch({ type: 'add-tab', tab })
  startTabSession(
    backend,
    dispatch,
    clearStartupGrace,
    (tabId) => startStartupGrace(tabId, STARTUP_GRACE_MS),
    tab,
    state.layout.terminalCols,
    state.layout.terminalRows,
    ctx.getCurrentSessionProjectPath()
  )
}

function startExistingTab(ctx: SideEffectContext, tab: TabSession): void {
  const { backend, dispatch, clearStartupGrace, startStartupGrace, state } = ctx
  startTabSession(
    backend,
    dispatch,
    clearStartupGrace,
    (tabId) => startStartupGrace(tabId, STARTUP_GRACE_MS),
    tab,
    state.layout.terminalCols,
    state.layout.terminalRows,
    ctx.getCurrentSessionProjectPath()
  )
}

function executeSplitPane(
  ctx: SideEffectContext,
  direction: SplitDirection,
  tab: TabSession
): void {
  const { state, dispatch, backend, clearStartupGrace, startStartupGrace } = ctx
  const activeTabId = state.activeTabId
  if (!activeTabId) {
    return
  }

  const existingTree = getTreeForTab(state.layoutTrees, state.tabGroupMap, activeTabId)
  const baseTree = existingTree ?? createLeaf(activeTabId)
  const newTree = splitNode(baseTree, activeTabId, direction, tab.id)
  const bounds = {
    x: 0,
    y: 0,
    cols: state.layout.terminalCols,
    rows: state.layout.terminalRows,
  }
  const paneRect = computePaneRects(newTree, bounds).get(tab.id)

  dispatch({ type: 'split-pane', direction, newTab: tab })
  startTabSession(
    backend,
    dispatch,
    clearStartupGrace,
    (tabId) => startStartupGrace(tabId, STARTUP_GRACE_MS),
    tab,
    Math.max(1, (paneRect?.cols ?? state.layout.terminalCols) - PANE_BORDER * 2),
    Math.max(1, (paneRect?.rows ?? state.layout.terminalRows) - PANE_BORDER * 2),
    ctx.getCurrentSessionProjectPath()
  )
}

export function executeSideEffect(effect: SideEffect, ctx: SideEffectContext): void {
  const { state, dispatch, backend } = ctx

  switch (effect.type) {
    case 'quit': {
      saveCurrentWorkspace(effect.state)
      void backend.destroy(true)
      ctx.renderer.destroy()
      process.exit(0)
      return
    }
    case 'launch-selected-assistant': {
      const option = getSelectedAssistantOption(state)
      launchAssistant(ctx, option.id)
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
        dispatch({ type: 'open-snippet-editor', snippetId: snippet.id })
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
      saveCustomCommandSelection(state)
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
      const customCommand = state.customCommands.terminal
      const tab = createTabSession('terminal', customCommand, state.customCommands)
      executeSplitPane(ctx, effect.direction, tab)
      return
    }
    case 'confirm-split': {
      confirmSplitSelection(ctx)
      return
    }
    default:
      effect satisfies never
  }
}
