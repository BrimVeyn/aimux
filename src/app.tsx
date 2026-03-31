import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'

import type { KeyResult, ModeContext, ModeId, SideEffect } from './input/modes/types'
import type { SessionBackend } from './session-backend/types'
import type {
  AssistantId,
  SessionRecord,
  SnippetRecord,
  TabSession,
  TerminalModeState,
} from './state/types'

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
import { loadSessionCatalog, saveSessionCatalog } from './state/session-catalog'
import { createEmptyWorkspaceSnapshot, serializeWorkspace } from './state/session-persistence'
import { loadSnippetCatalog, saveSnippetCatalog } from './state/snippet-catalog'
import { appReducer, createInitialState, filterSessions, filterSnippets } from './state/store'
import { buildSessionsWithCurrentSnapshot, saveCurrentWorkspace } from './state/workspace-save'
import { searchDirectories } from './ui/directory-search'
import { RootView } from './ui/root'
import { applyTheme } from './ui/theme'
import { type ThemeId, THEME_IDS } from './ui/themes'

registerAllModes()

const IDLE_TIMEOUT_MS = 2_000
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
  const index = ['claude', 'codex', 'opencode'].indexOf(assistant)
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
  const idleTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const startupGraceTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const workspaceSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attachRequestIdRef = useRef(0)
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

  useEffect(() => {
    if (!state.currentSessionId) {
      return
    }

    backend.setActiveTab(state.activeTabId)
  }, [backend, state.activeTabId, state.currentSessionId])

  useEffect(() => {
    const currentSessionId = state.currentSessionId
    if (!currentSessionId) {
      attachRequestIdRef.current += 1
      return
    }

    const attachRequestId = attachRequestIdRef.current + 1
    attachRequestIdRef.current = attachRequestId
    let cancelled = false

    void backend
      .attach({
        sessionId: currentSessionId,
        cols: layoutRef.current.terminalCols,
        rows: layoutRef.current.terminalRows,
        workspaceSnapshot: currentSession?.workspaceSnapshot,
      })
      .then((result) => {
        if (cancelled || attachRequestIdRef.current !== attachRequestId) {
          return
        }
        logInputDebug('app.backend.attachResult', {
          hasResult: !!result,
          tabs: result?.tabs.length ?? 0,
          activeTabId: result?.activeTabId ?? null,
        })
        if (result) {
          dispatch({
            type: 'hydrate-workspace',
            tabs: result.tabs,
            activeTabId: result.activeTabId,
          })
        } else if (currentSession?.workspaceSnapshot) {
          dispatch({
            type: 'load-session',
            sessionId: currentSessionId,
            workspaceSnapshot: currentSession.workspaceSnapshot,
          })
        }
      })
      .catch((error) => {
        if (cancelled || attachRequestIdRef.current !== attachRequestId) {
          return
        }
        logInputDebug('app.backend.attachError', {
          error: error instanceof Error ? error.message : String(error),
        })
        if (currentSession?.workspaceSnapshot) {
          dispatch({
            type: 'load-session',
            sessionId: currentSessionId,
            workspaceSnapshot: currentSession.workspaceSnapshot,
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [backend, currentSession?.workspaceSnapshot, state.currentSessionId])

  function clearIdleTimer(tabId: string) {
    const timeout = idleTimeoutsRef.current.get(tabId)
    if (timeout) {
      clearTimeout(timeout)
      idleTimeoutsRef.current.delete(tabId)
    }
  }

  function clearStartupGrace(tabId: string) {
    const timeout = startupGraceTimeoutsRef.current.get(tabId)
    if (timeout) {
      clearTimeout(timeout)
      startupGraceTimeoutsRef.current.delete(tabId)
    }
  }

  function isStartupGraceActive(tabId: string): boolean {
    return startupGraceTimeoutsRef.current.has(tabId)
  }

  function startStartupGrace(tabId: string) {
    clearStartupGrace(tabId)
    const timeout = setTimeout(() => {
      startupGraceTimeoutsRef.current.delete(tabId)
    }, STARTUP_GRACE_MS)
    startupGraceTimeoutsRef.current.set(tabId, timeout)
  }

  function scheduleIdle(tabId: string) {
    clearIdleTimer(tabId)
    const timeout = setTimeout(() => {
      dispatch({ type: 'set-tab-activity', tabId, activity: 'idle' })
      idleTimeoutsRef.current.delete(tabId)
    }, IDLE_TIMEOUT_MS)
    idleTimeoutsRef.current.set(tabId, timeout)
  }

  useEffect(() => {
    if (workspaceSaveTimeoutRef.current) {
      clearTimeout(workspaceSaveTimeoutRef.current)
    }

    workspaceSaveTimeoutRef.current = setTimeout(() => {
      saveCurrentWorkspace(state)
      workspaceSaveTimeoutRef.current = null
    }, WORKSPACE_SAVE_DEBOUNCE_MS)

    return () => {
      if (workspaceSaveTimeoutRef.current) {
        clearTimeout(workspaceSaveTimeoutRef.current)
        workspaceSaveTimeoutRef.current = null
        saveCurrentWorkspace(state)
      }
    }
  }, [state])

  useEffect(() => {
    const idleTimeouts = idleTimeoutsRef.current
    const startupGraceTimeouts = startupGraceTimeoutsRef.current

    const handleRender = (
      tabId: string,
      viewport: TabSession['viewport'],
      terminalModes: TerminalModeState
    ) => {
      if (!viewport) {
        return
      }

      dispatch({ type: 'replace-tab-viewport', tabId, viewport, terminalModes })
      if (isStartupGraceActive(tabId) || resizingRef.current) {
        return
      }

      dispatch({ type: 'set-tab-activity', tabId, activity: 'busy' })
      scheduleIdle(tabId)
    }

    const handleExit = (tabId: string, exitCode: number) => {
      clearIdleTimer(tabId)
      clearStartupGrace(tabId)
      dispatch({ type: 'set-tab-status', tabId, status: 'exited', exitCode })
      dispatch({ type: 'set-tab-activity', tabId, activity: undefined })
    }

    const handleError = (tabId: string, message: string) => {
      clearIdleTimer(tabId)
      clearStartupGrace(tabId)
      dispatch({ type: 'set-tab-error', tabId, message })
    }

    backend.on('render', handleRender)
    backend.on('exit', handleExit)
    backend.on('error', handleError)

    return () => {
      for (const timeout of idleTimeouts.values()) {
        clearTimeout(timeout)
      }
      idleTimeouts.clear()
      for (const timeout of startupGraceTimeouts.values()) {
        clearTimeout(timeout)
      }
      startupGraceTimeouts.clear()
      if (workspaceSaveTimeoutRef.current) {
        clearTimeout(workspaceSaveTimeoutRef.current)
      }
      backend.off('render', handleRender)
      backend.off('exit', handleExit)
      backend.off('error', handleError)
      void backend.destroy(true)
    }
  }, [backend])

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

  const directoryQuery =
    state.modal.type === 'create-session'
      ? state.modal.activeField === 'directory'
        ? (state.modal.editBuffer ?? '')
        : (state.modal.secondaryBuffer ?? '')
      : ''

  useEffect(() => {
    if (state.modal.type !== 'create-session') return
    if (!directoryQuery.trim()) {
      dispatch({ type: 'set-directory-results', results: [] })
      return
    }
    const timer = setTimeout(async () => {
      const results = await searchDirectories(directoryQuery)
      dispatch({ type: 'set-directory-results', results })
    }, 200)
    return () => clearTimeout(timer)
  }, [state.modal.type, directoryQuery])

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
      startStartupGrace,
      tab,
      state.layout.terminalCols,
      state.layout.terminalRows,
      getCurrentSessionProjectPath()
    )
  }

  function createSessionFromCurrent(name: string, projectPath?: string): void {
    const now = new Date().toISOString()
    const workspaceSnapshot =
      state.currentSessionId || state.tabs.length === 0
        ? createEmptyWorkspaceSnapshot()
        : serializeWorkspace(state)
    const session: SessionRecord = {
      id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      projectPath,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      workspaceSnapshot,
    }
    let updatedSessions = state.sessions
    if (state.currentSessionId) {
      const currentSnapshot = serializeWorkspace(state)
      updatedSessions = state.sessions.map((s) =>
        s.id === state.currentSessionId
          ? { ...s, updatedAt: now, workspaceSnapshot: currentSnapshot }
          : s
      )
    }
    const sessions = [...updatedSessions, session]
    logInputDebug('app.session.create', {
      sessionId: session.id,
      name,
      fromCurrentWorkspace: !state.currentSessionId && state.tabs.length > 0,
      tabCount: workspaceSnapshot.tabs.length,
    })
    saveSessionCatalog(sessions)
    dispatch({ type: 'set-sessions', sessions })
    dispatch({
      type: 'load-session',
      sessionId: session.id,
      workspaceSnapshot: session.workspaceSnapshot,
    })
  }

  function renameSession(sessionId: string, name: string): void {
    logInputDebug('app.session.rename', { sessionId, name })
    const sessions = state.sessions.map((session) =>
      session.id === sessionId ? { ...session, name, updatedAt: new Date().toISOString() } : session
    )
    saveSessionCatalog(sessions)
    dispatch({ type: 'rename-session-record', sessionId, name })
  }

  function switchToSession(session: SessionRecord): void {
    logInputDebug('app.session.switch.start', {
      fromSessionId: state.currentSessionId,
      toSessionId: session.id,
      toName: session.name,
      currentTabCount: state.tabs.length,
      restoredTabCount: session.workspaceSnapshot?.tabs.length ?? 0,
    })
    const sessionsWithSnapshot = buildSessionsWithCurrentSnapshot(
      state.sessions,
      state.currentSessionId,
      state
    )
    const sessions = sessionsWithSnapshot.map((entry) =>
      entry.id === session.id ? { ...entry, lastOpenedAt: new Date().toISOString() } : entry
    )
    saveSessionCatalog(sessions)
    void backend.destroy(true)
    dispatch({ type: 'set-sessions', sessions })
    dispatch({
      type: 'load-session',
      sessionId: session.id,
      workspaceSnapshot: session.workspaceSnapshot,
    })
    logInputDebug('app.session.switch.dispatched', {
      toSessionId: session.id,
    })
  }

  function deleteSession(sessionId: string): void {
    const remaining = state.sessions.filter((session) => session.id !== sessionId)
    logInputDebug('app.session.delete', {
      sessionId,
      wasCurrent: sessionId === state.currentSessionId,
      remainingCount: remaining.length,
    })
    saveSessionCatalog(remaining)
    if (sessionId === state.currentSessionId) {
      void backend.destroy(true)
    }
    dispatch({ type: 'delete-session-record', sessionId })
  }

  function restartTab(tab: TabSession): void {
    logInputDebug('app.restartTab', {
      tabId: tab.id,
      command: tab.command,
      status: tab.status,
    })
    clearIdleTimer(tab.id)
    clearStartupGrace(tab.id)
    backend.disposeSession(tab.id)
    dispatch({ type: 'reset-tab-session', tabId: tab.id })
    startTabSession(
      backend,
      dispatch,
      clearStartupGrace,
      startStartupGrace,
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
          switchToSession(selectedSession)
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
          deleteSession(selectedSession.id)
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
        createSessionFromCurrent(effect.name, effect.projectPath)
        return
      case 'close-tab': {
        clearIdleTimer(effect.tabId)
        clearStartupGrace(effect.tabId)
        backend.disposeSession(effect.tabId)
        return
      }
      case 'restart-tab':
        restartTab(effect.tab)
        return
      case 'paste-selected-snippet': {
        const filtered = getFilteredSnippets()
        const snippet = filtered[state.modal.selectedIndex]
        if (snippet && state.activeTabId && activeTab) {
          const payload = buildPtyPastePayload(
            snippet.content,
            activeTab.terminalModes.bracketedPasteMode
          )
          backend.write(state.activeTabId, payload)
        }
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
          const updated = state.snippets.filter((s) => s.id !== snippet.id)
          saveSnippetCatalog(updated)
          dispatch({ type: 'delete-snippet', snippetId: snippet.id })
        }
        return
      }
      case 'save-snippet-editor': {
        if (state.modal.type !== 'snippet-editor') return
        const modal = state.modal
        const name =
          modal.activeField === 'directory'
            ? (modal.editBuffer ?? '').trim()
            : (modal.secondaryBuffer ?? '').trim()
        const content =
          modal.activeField === 'name'
            ? (modal.editBuffer ?? '').trim()
            : (modal.secondaryBuffer ?? '').trim()
        if (name && content) {
          const snippetId = modal.sessionTargetId
          let updated: SnippetRecord[]
          if (snippetId) {
            updated = state.snippets.map((s) => (s.id === snippetId ? { ...s, name, content } : s))
          } else {
            const newSnippet: SnippetRecord = {
              id: `snip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              name,
              content,
            }
            updated = [...state.snippets, newSnippet]
          }
          saveSnippetCatalog(updated)
          dispatch({ type: 'set-snippets', snippets: updated })
        }
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
        renameSession(effect.sessionId, effect.name)
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
