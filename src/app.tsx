import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'

import type { KeyResult, ModeContext, ModeId, SideEffect } from './input/modes/types'
import type { SessionBackend } from './session-backend/types'
import type { AssistantId, SessionRecord, SnippetRecord, TabSession } from './state/types'

import {
  handleCreateSessionEffect,
  handleDeleteSessionEffect,
  handleRenameSessionEffect,
  handleSwitchSessionEffect,
  restartTabSession,
} from './app-runtime/session-actions'
import {
  handleDeleteSnippetEffect,
  handleSaveSnippetEditorEffect,
  pasteSnippetToTab,
} from './app-runtime/snippet-actions'
import { useBackendRuntime } from './app-runtime/use-backend-runtime'
import { useDirectorySearch } from './app-runtime/use-directory-search'
import { useWorkspaceAutosave } from './app-runtime/use-workspace-autosave'
import { loadConfig, saveConfig } from './config'
import { INPUT_DEBUG_LOG_PATH, logInputDebug } from './debug/input-log'
import { deriveModeId } from './input/modes/bridge'
import { registerAllModes } from './input/modes/handlers'
import { getHandler, transitionTo } from './input/modes/registry'
import { encodeMouseEventForPty } from './input/mouse-forwarding'
import { MultiClickDetector } from './input/multi-click-detector'
import { buildPtyPastePayload } from './input/paste'
import { createRawInputHandler, type TerminalContentOrigin } from './input/raw-input-handler'
import { getLineText, getWordAtColumn } from './input/terminal-text-extraction'
import { copyToSystemClipboard } from './platform/clipboard'
import {
  ASSISTANT_OPTIONS,
  getAssistantOption,
  isCommandAvailable,
  parseCommand,
} from './pty/command-registry'
import { filterSessions, filterSnippets } from './state/selectors'
import { loadSessionCatalog } from './state/session-catalog'
import { loadSnippetCatalog } from './state/snippet-catalog'
import { appReducer, createInitialState } from './state/store'
import { saveCurrentWorkspace } from './state/workspace-save'
import { RootView } from './ui/root'
import { applyTheme } from './ui/theme'
import { type ThemeId, THEME_IDS } from './ui/themes'

registerAllModes()

const STARTUP_GRACE_MS = 5_000
const MAIN_AREA_HORIZONTAL_CHROME = 4
const MAIN_AREA_VERTICAL_PADDING = 2
const STATUS_BAR_HEIGHT = 4
const TERMINAL_PANE_VERTICAL_CHROME = 4
const MIN_TERMINAL_ROWS = 1
const MIN_TERMINAL_COLS = 20
const WORKSPACE_SAVE_DEBOUNCE_MS = 250

function createTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createTabSession(assistant: AssistantId, customCommand?: string): TabSession {
  const index = ASSISTANT_OPTIONS.findIndex((o) => o.id === assistant)
  const option = getAssistantOption(index)

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

function startTabSession(
  backend: SessionBackend,
  dispatch: (action: Parameters<typeof appReducer>[1]) => void,
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

export function App({ backend }: { backend: SessionBackend }) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const [themeId, setThemeId] = useState<ThemeId>(() => {
    const config = loadConfig()
    if (config.themeId) {
      applyTheme(config.themeId)
    }
    return config.themeId ?? 'aimux'
  })
  const [state, dispatch] = useReducer(appReducer, undefined, () => {
    const { customCommands } = loadConfig()
    return createInitialState(customCommands, loadSessionCatalog(), loadSnippetCatalog(), true)
  })
  const resizingRef = useRef(false)
  const resizingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const layoutRef = useRef(state.layout)
  layoutRef.current = state.layout
  const activeTab = useMemo(
    () => state.tabs.find((tab) => tab.id === state.activeTabId),
    [state.activeTabId, state.tabs]
  )
  const currentSession = useMemo(
    () => state.sessions.find((session) => session.id === state.currentSessionId),
    [state.currentSessionId, state.sessions]
  )
  const activeMouseForwardingEnabled = activeTab?.terminalModes.mouseTrackingMode !== 'none'
  const activeLocalScrollbackEnabled =
    !!activeTab && !activeMouseForwardingEnabled && !activeTab.terminalModes.isAlternateBuffer

  const focusModeRef = useRef(state.focusMode)
  focusModeRef.current = state.focusMode

  const activeTabIdRef = useRef(state.activeTabId)
  activeTabIdRef.current = state.activeTabId
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab

  const contentOriginRef = useRef<TerminalContentOrigin>({ x: 0, y: 0, cols: 0, rows: 0 })
  const multiClickRef = useRef(new MultiClickDetector())
  const currentSessionWorkspaceSnapshot = currentSession?.workspaceSnapshot

  const { clearIdleTimer, clearStartupGrace, startStartupGrace } = useBackendRuntime({
    backend,
    dispatch,
    activeTabId: state.activeTabId,
    currentSessionId: state.currentSessionId,
    currentSessionWorkspaceSnapshot,
    layoutRef,
    resizingRef,
  })

  useWorkspaceAutosave(state, WORKSPACE_SAVE_DEBOUNCE_MS)
  useDirectorySearch(state.modal, dispatch)

  useEffect(() => {
    renderer.useMouse = true
    renderer.useConsole = false
    renderer.console.hide()
    renderer.console.show = () => {}

    const handler = createRawInputHandler({
      getFocusMode: () => focusModeRef.current,
      getActiveTabId: () => activeTabIdRef.current,
      getContentOrigin: () => contentOriginRef.current,
      getMousePassthroughEnabled: () => activeTabRef.current !== undefined,
      getBracketedPasteModeEnabled: () =>
        activeTabRef.current?.terminalModes.bracketedPasteMode ?? false,
      writeToPty: (tabId, data) => {
        const viewport = activeTabRef.current?.viewport
        if (viewport && viewport.viewportY < viewport.baseY) {
          backend.scrollViewportToBottom(tabId)
        }
        backend.write(tabId, data)
      },
      leaveTerminalInput: () => dispatch({ type: 'set-focus-mode', focusMode: 'navigation' }),
      toggleSidebar: () => dispatch({ type: 'toggle-sidebar' }),
    })

    const handlePasteEvent = (event: { bytes: Uint8Array; defaultPrevented?: boolean }) => {
      logInputDebug('app.rendererPaste', {
        defaultPrevented: event.defaultPrevented ?? false,
        byteLength: event.bytes.length,
      })

      if (event.defaultPrevented) {
        return
      }

      const tab = activeTabRef.current
      const tabId = activeTabIdRef.current
      const focusMode = focusModeRef.current

      logInputDebug('app.onTerminalPaste', {
        activeTabId: tabId,
        focusMode,
        byteLength: event.bytes.length,
        decodedPreview: new TextDecoder().decode(event.bytes).slice(0, 120),
        bracketedPasteMode: tab?.terminalModes.bracketedPasteMode ?? false,
      })

      if (focusMode !== 'terminal-input' || !tabId || !tab) {
        return
      }

      if (tab.viewport && tab.viewport.viewportY < tab.viewport.baseY) {
        backend.scrollViewportToBottom(tabId)
      }

      const payload = new TextDecoder().decode(event.bytes)
      backend.write(tabId, buildPtyPastePayload(payload, tab.terminalModes.bracketedPasteMode))
    }

    const handleSelection = (selection: { isDragging?: boolean; getSelectedText(): string }) => {
      const selectedText = selection.getSelectedText()
      logInputDebug('app.selection', {
        isDragging: selection.isDragging ?? false,
        textLength: selectedText.length,
        osc52Supported: renderer.isOsc52Supported(),
      })

      if (selection.isDragging || selectedText.length === 0) {
        return
      }

      renderer.copyToClipboardOSC52(selectedText)
      copyToSystemClipboard(selectedText)
    }

    renderer.prependInputHandler(handler)
    renderer.keyInput.on('paste', handlePasteEvent)
    renderer.on('selection', handleSelection)
    return () => {
      renderer.removeInputHandler(handler)
      renderer.keyInput.off('paste', handlePasteEvent)
      renderer.off('selection', handleSelection)
    }
  }, [backend, renderer])

  useEffect(() => {
    const shouldEnableBracketedPaste = state.focusMode === 'terminal-input' && !!state.activeTabId
    logInputDebug('app.bracketedPasteMode', {
      enabled: shouldEnableBracketedPaste,
      activeTabId: state.activeTabId,
      focusMode: state.focusMode,
      logPath: INPUT_DEBUG_LOG_PATH,
    })
    process.stdout.write(shouldEnableBracketedPaste ? '\x1b[?2004h' : '\x1b[?2004l')

    return () => {
      process.stdout.write('\x1b[?2004l')
    }
  }, [state.activeTabId, state.focusMode])

  const handleTerminalMouseEvent = (event: OtuiMouseEvent, origin: TerminalContentOrigin) => {
    if (
      state.focusMode !== 'terminal-input' ||
      !state.activeTabId ||
      !activeMouseForwardingEnabled
    ) {
      return
    }

    const sequence = encodeMouseEventForPty(event, origin)
    if (!sequence) {
      return
    }

    backend.write(state.activeTabId, sequence)
  }

  const handleTerminalScrollEvent = (event: OtuiMouseEvent) => {
    if (state.focusMode !== 'terminal-input' || !state.activeTabId) {
      return
    }

    if (activeMouseForwardingEnabled) {
      return
    }

    if (!activeLocalScrollbackEnabled || event.type !== 'scroll') {
      return
    }

    const direction = event.scroll?.direction
    if (direction === 'up') {
      backend.scrollViewport(state.activeTabId, -3)
    } else if (direction === 'down') {
      backend.scrollViewport(state.activeTabId, 3)
    }
  }

  const handleTerminalClick = (event: OtuiMouseEvent, origin: TerminalContentOrigin) => {
    if (state.focusMode !== 'terminal-input' || !state.activeTabId || !event.target) {
      return
    }

    const col = event.x - origin.x
    const row = event.y - origin.y
    const clickCount = multiClickRef.current.track(col, row)

    if (clickCount < 2) {
      return
    }

    const tab = state.tabs.find((t) => t.id === state.activeTabId)
    if (!tab?.viewport?.lines[row]) {
      return
    }

    const line = tab.viewport.lines[row]
    const lineBox = event.target.parent
    if (!lineBox) {
      return
    }
    const baseX = lineBox.x

    const lineText = getLineText(line)
    let selectedText: string
    let startCol: number
    let endCol: number

    if (clickCount === 2) {
      const word = getWordAtColumn(lineText, col)
      if (word.text.length === 0) {
        return
      }
      selectedText = word.text
      startCol = word.startCol
      endCol = word.endCol
    } else {
      selectedText = lineText
      startCol = 0
      endCol = lineText.length
    }

    event.preventDefault()
    renderer.clearSelection()
    renderer.startSelection(event.target, baseX + startCol, event.y)
    renderer.updateSelection(event.target, baseX + endCol, event.y, {
      finishDragging: true,
    })
    copyToSystemClipboard(selectedText)
  }

  const terminalSize = useMemo(() => {
    const sidebarWidth = state.sidebar.visible ? state.sidebar.width + 3 : 0
    const reservedRows =
      MAIN_AREA_VERTICAL_PADDING + STATUS_BAR_HEIGHT + TERMINAL_PANE_VERTICAL_CHROME
    const cols = Math.max(
      MIN_TERMINAL_COLS,
      Math.floor(dimensions.width - sidebarWidth - MAIN_AREA_HORIZONTAL_CHROME)
    )
    const rows = Math.max(MIN_TERMINAL_ROWS, Math.floor(dimensions.height - reservedRows))

    // Terminal content origin in 0-based screen cells.
    // X: root padding(1) + sidebar outer(sidebarWidth) + terminal border(1) + terminal padding(1)
    // Y: root padding(1) + terminal border(1) + terminal padding(1)
    contentOriginRef.current = {
      x: 1 + sidebarWidth + 1 + 1,
      y: 1 + 1 + 1,
      cols,
      rows,
    }

    return { cols, rows }
  }, [dimensions.height, dimensions.width, state.sidebar.visible, state.sidebar.width])

  useEffect(() => {
    dispatch({
      type: 'set-terminal-size',
      cols: terminalSize.cols,
      rows: terminalSize.rows,
    })
    resizingRef.current = true
    if (resizingTimerRef.current) {
      clearTimeout(resizingTimerRef.current)
    }
    backend.resizeAll(terminalSize.cols, terminalSize.rows)
    resizingTimerRef.current = setTimeout(() => {
      resizingRef.current = false
      resizingTimerRef.current = null
    }, 500)
  }, [backend, terminalSize.cols, terminalSize.rows])

  function getCurrentSessionProjectPath(): string | undefined {
    if (!state.currentSessionId) return undefined
    return state.sessions.find((s) => s.id === state.currentSessionId)?.projectPath
  }

  function getFilteredSessions(): SessionRecord[] {
    const filter = state.modal.type === 'session-picker' ? state.modal.editBuffer : null
    return filterSessions(state.sessions, filter)
  }

  function getFilteredSnippets(): SnippetRecord[] {
    const filter = state.modal.type === 'snippet-picker' ? state.modal.editBuffer : null
    return filterSnippets(state.snippets, filter)
  }

  function launchAssistant(assistant: AssistantId) {
    const customCommand = state.customCommands[assistant]
    const tab = createTabSession(assistant, customCommand)
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
      getCurrentSessionProjectPath()
    )
  }

  function startExistingTab(tab: TabSession): void {
    startTabSession(
      backend,
      dispatch,
      clearStartupGrace,
      (tabId) => startStartupGrace(tabId, STARTUP_GRACE_MS),
      tab,
      state.layout.terminalCols,
      state.layout.terminalRows,
      getCurrentSessionProjectPath()
    )
  }

  function executeSideEffect(effect: SideEffect): void {
    switch (effect.type) {
      case 'quit': {
        saveCurrentWorkspace(effect.state)
        void backend.destroy(true)
        renderer.destroy()
        process.exit(0)
        return
      }
      case 'launch-selected-assistant': {
        const option = getAssistantOption(state.modal.selectedIndex)
        launchAssistant(option.id)
        return
      }
      case 'confirm-selected-session': {
        const filtered = getFilteredSessions()
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
        const filtered = getFilteredSessions()
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
        const filtered = getFilteredSessions()
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
        clearIdleTimer(effect.tabId)
        clearStartupGrace(effect.tabId)
        backend.disposeSession(effect.tabId)
        return
      }
      case 'restart-tab':
        restartTabSession(
          backend,
          dispatch,
          clearIdleTimer,
          clearStartupGrace,
          startExistingTab,
          effect.tab
        )
        return
      case 'paste-selected-snippet': {
        const filtered = getFilteredSnippets()
        pasteSnippetToTab(
          backend,
          state.activeTabId,
          activeTab,
          filtered[state.modal.selectedIndex]
        )
        return
      }
      case 'edit-selected-snippet': {
        const filtered = getFilteredSnippets()
        const snippet = filtered[state.modal.selectedIndex]
        if (snippet) {
          dispatch({ type: 'open-snippet-editor', snippetId: snippet.id })
        }
        return
      }
      case 'delete-selected-snippet': {
        const filtered = getFilteredSnippets()
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
        const option = ASSISTANT_OPTIONS[state.modal.selectedIndex]
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
            applyTheme(themeId)
            break
          case 'confirm': {
            const selectedId = THEME_IDS[state.modal.selectedIndex]
            if (selectedId) {
              applyTheme(selectedId)
              setThemeId(selectedId)
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
    }
  }

  function processKeyResult(result: KeyResult, modeId: ModeId): void {
    for (const action of result.actions) {
      dispatch(action)
    }

    if (result.transition) {
      const transResult = transitionTo(modeId, result.transition, { state })
      for (const action of transResult.actions) {
        dispatch(action)
      }
      for (const effect of transResult.effects) {
        executeSideEffect(effect)
      }
    }

    for (const effect of result.effects) {
      executeSideEffect(effect)
    }
  }

  useKeyboard((key) => {
    // Global quit: Ctrl+C in any mode except terminal-input
    if (key.ctrl && key.name === 'c' && state.focusMode !== 'terminal-input') {
      key.preventDefault()
      executeSideEffect({ type: 'quit', state })
      return
    }

    const modeId = deriveModeId(state)
    const handler = getHandler(modeId)
    if (!handler) return

    const ctx: ModeContext = { state }
    const result = handler.handleKey(key, ctx)
    if (!result) return

    key.preventDefault()
    processKeyResult(result, modeId)
  })

  return (
    <RootView
      state={state}
      themeId={themeId}
      contentOrigin={contentOriginRef.current}
      mouseForwardingEnabled={activeMouseForwardingEnabled}
      localScrollbackEnabled={activeLocalScrollbackEnabled}
      onTerminalMouseEvent={handleTerminalMouseEvent}
      onTerminalScrollEvent={handleTerminalScrollEvent}
      onTerminalClick={handleTerminalClick}
    />
  )
}
