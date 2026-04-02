import type { SideEffect } from '../input/modes/types'
import type { SessionBackend } from '../session-backend/types'
import type { SplitDirection } from '../state/layout-tree'
import type { AppAction, AppState, AssistantId, TabSession } from '../state/types'
import type { ThemeId } from '../ui/themes'

import { loadConfig, saveConfig } from '../config'
import { logInputDebug } from '../debug/input-log'
import {
  getAllAssistantOptions,
  getAssistantOption,
  isCommandAvailable,
  parseCommand,
} from '../pty/command-registry'
import {
  PANE_BORDER,
  computePaneRects,
  createLeaf,
  findLeaf,
  splitNode,
} from '../state/layout-tree'
import { filterSessions, filterSnippets } from '../state/selectors'
import { saveCurrentWorkspace } from '../state/workspace-save'
import { applyTheme } from '../ui/theme'
import { THEME_IDS } from '../ui/themes'
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

function createTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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
    terminalModes: {
      mouseTrackingMode: 'none',
      sendFocusMode: false,
      alternateScrollMode: false,
      isAlternateBuffer: false,
      bracketedPasteMode: false,
    },
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
  const currentTree = state.layoutTree ?? createLeaf(state.activeTabId!)
  const baseTree = findLeaf(currentTree, state.activeTabId!)
    ? currentTree
    : createLeaf(state.activeTabId!)
  const newTree = splitNode(baseTree, state.activeTabId!, direction, tab.id)
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
      const allOptions = getAllAssistantOptions(state.customCommands)
      const option = allOptions[state.modal.selectedIndex] ?? getAssistantOption(0)
      launchAssistant(ctx, option.id)
      return
    }
    case 'confirm-selected-session': {
      const filtered = filterSessions(
        state.sessions,
        state.modal.type === 'session-picker' ? state.modal.editBuffer : null
      )
      logInputDebug('app.sessionPicker.confirm', {
        selectedIndex: state.modal.selectedIndex,
        selectedSessionId: filtered[state.modal.selectedIndex]?.id ?? null,
        creatingNew: state.modal.selectedIndex === filtered.length,
      })
      const selectedSession = filtered[state.modal.selectedIndex]
      if (selectedSession) {
        handleSwitchSessionEffect(state, backend, dispatch, selectedSession)
      } else {
        dispatch({ type: 'open-create-session-modal' })
      }
      return
    }
    case 'delete-selected-session': {
      const filtered = filterSessions(
        state.sessions,
        state.modal.type === 'session-picker' ? state.modal.editBuffer : null
      )
      const selectedSession = filtered[state.modal.selectedIndex]
      logInputDebug('app.sessionPicker.deleteSelected', {
        selectedIndex: state.modal.selectedIndex,
        selectedSessionId: selectedSession?.id ?? null,
      })
      if (selectedSession) {
        handleDeleteSessionEffect(state, backend, dispatch, selectedSession.id)
      }
      return
    }
    case 'open-rename-selected-session': {
      const filtered = filterSessions(
        state.sessions,
        state.modal.type === 'session-picker' ? state.modal.editBuffer : null
      )
      const selectedSession = filtered[state.modal.selectedIndex]
      if (selectedSession) {
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
      const filtered = filterSnippets(
        state.snippets,
        state.modal.type === 'snippet-picker' ? state.modal.editBuffer : null
      )
      pasteSnippetToTab(
        backend,
        state.activeTabId,
        ctx.activeTab,
        filtered[state.modal.selectedIndex]
      )
      return
    }
    case 'edit-selected-snippet': {
      const filtered = filterSnippets(
        state.snippets,
        state.modal.type === 'snippet-picker' ? state.modal.editBuffer : null
      )
      const snippet = filtered[state.modal.selectedIndex]
      if (snippet) {
        dispatch({ type: 'open-snippet-editor', snippetId: snippet.id })
      }
      return
    }
    case 'delete-selected-snippet': {
      const filtered = filterSnippets(
        state.snippets,
        state.modal.type === 'snippet-picker' ? state.modal.editBuffer : null
      )
      const snippet = filtered[state.modal.selectedIndex]
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
      const allOptions = getAllAssistantOptions(state.customCommands)
      const option = allOptions[state.modal.selectedIndex]
      if (option && state.modal.editBuffer !== null) {
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
      return
    }
    case 'apply-theme': {
      switch (effect.action) {
        case 'open':
          applyTheme(THEME_IDS[0] ?? 'aimux')
          break
        case 'restore':
          applyTheme(ctx.themeId)
          break
        case 'confirm': {
          const selectedId = THEME_IDS[state.modal.selectedIndex]
          if (selectedId) {
            applyTheme(selectedId)
            ctx.setThemeId(selectedId)
            saveConfig({ ...loadConfig(), themeId: selectedId })
          }
          break
        }
        case 'preview': {
          const count = THEME_IDS.length
          const nextIndex = (state.modal.selectedIndex + effect.delta + count) % count
          const previewId = THEME_IDS[nextIndex]
          if (previewId) {
            applyTheme(previewId)
          }
          break
        }
      }
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
      const allOptions = getAllAssistantOptions(state.customCommands)
      const option = allOptions[state.modal.selectedIndex] ?? getAssistantOption(0)
      const direction =
        state.modal.type === 'split-picker' ? state.modal.splitDirection : 'vertical'
      const customCommand = state.customCommands[option.id]
      const tab = createTabSession(option.id, customCommand, state.customCommands)
      dispatch({ type: 'close-modal' })
      executeSplitPane(ctx, direction, tab)
      dispatch({ type: 'set-focus-mode', focusMode: 'terminal-input' })
      return
    }
  }
}
