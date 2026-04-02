import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'

import type { KeyResult, ModeContext, ModeId } from './input/modes/types'
import type { SessionBackend } from './session-backend/types'
import type { ThemeId } from './ui/themes'

import { type SideEffectContext, executeSideEffect } from './app-runtime/side-effects'
import { useBackendRuntime } from './app-runtime/use-backend-runtime'
import { useDirectorySearch } from './app-runtime/use-directory-search'
import { useWorkspaceAutosave } from './app-runtime/use-workspace-autosave'
import { loadConfig } from './config'
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
import { PANE_BORDER, computePaneRects } from './state/layout-tree'
import { loadSessionCatalog } from './state/session-catalog'
import { loadSnippetCatalog } from './state/snippet-catalog'
import { appReducer, createInitialState } from './state/store'
import { RootView } from './ui/root'
import { applyTheme } from './ui/theme'

registerAllModes()

const MAIN_AREA_HORIZONTAL_CHROME = 2
const MAIN_AREA_VERTICAL_PADDING = 0
const STATUS_BAR_HEIGHT = 4
const TERMINAL_PANE_VERTICAL_CHROME = 2
const MIN_TERMINAL_ROWS = 1
const MIN_TERMINAL_COLS = 20
const WORKSPACE_SAVE_DEBOUNCE_MS = 250

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
      enterLayoutMode: () => dispatch({ type: 'set-focus-mode', focusMode: 'layout' }),
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

  const separatorDragRef = useRef<{
    tabId: string
    direction: import('./state/layout-tree').SplitDirection
    screenStart: number
    totalSize: number
  } | null>(null)

  const handleSplitResize = (
    tabId: string,
    ratio: number,
    axis: import('./state/layout-tree').SplitDirection
  ) => {
    dispatch({ type: 'set-split-ratio', tabId, ratio, axis })
  }

  const handleSeparatorDragStart = (info: {
    tabId: string
    direction: import('./state/layout-tree').SplitDirection
    screenStart: number
    totalSize: number
  }) => {
    separatorDragRef.current = info
  }

  const handleSeparatorDrag = (event: OtuiMouseEvent): boolean => {
    const drag = separatorDragRef.current
    if (!drag) return false
    const pos = drag.direction === 'vertical' ? event.x : event.y
    const newRatio = (pos - drag.screenStart) / drag.totalSize
    dispatch({ type: 'set-split-ratio', tabId: drag.tabId, ratio: newRatio, axis: drag.direction })
    return true
  }

  const handleSeparatorDragEnd = () => {
    separatorDragRef.current = null
  }

  const handlePaneActivate = (tabId: string) => {
    if (tabId !== state.activeTabId) {
      dispatch({ type: 'set-active-tab', tabId })
    }
    if (state.focusMode !== 'terminal-input') {
      dispatch({ type: 'set-focus-mode', focusMode: 'terminal-input' })
    }
  }

  const handleTerminalClick = (
    event: OtuiMouseEvent,
    origin: TerminalContentOrigin,
    tabId?: string
  ) => {
    const targetTabId = tabId ?? state.activeTabId
    if (!targetTabId || !event.target) {
      return
    }

    const col = event.x - origin.x
    const row = event.y - origin.y
    const clickCount = multiClickRef.current.track(col, row)

    if (clickCount < 2) {
      return
    }

    const tab = state.tabs.find((t) => t.id === targetTabId)
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
    const sidebarWidth = state.sidebar.visible ? state.sidebar.width + 1 : 0
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
    // X: sidebar outer(sidebarWidth) + terminal border(1)
    // Y: terminal border(1)
    contentOriginRef.current = {
      x: sidebarWidth + 1,
      y: 1,
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
    if (state.layoutTree && state.layoutTree.type === 'split') {
      const bounds = { x: 0, y: 0, cols: terminalSize.cols, rows: terminalSize.rows }
      const rects = computePaneRects(state.layoutTree, bounds)
      const chrome = PANE_BORDER * 2
      for (const [tabId, rect] of rects) {
        backend.resizeTab(tabId, Math.max(1, rect.cols - chrome), Math.max(1, rect.rows - chrome))
      }
    } else {
      backend.resizeAll(terminalSize.cols, terminalSize.rows)
    }
    resizingTimerRef.current = setTimeout(() => {
      resizingRef.current = false
      resizingTimerRef.current = null
    }, 500)
  }, [backend, terminalSize.cols, terminalSize.rows, state.layoutTree])

  const sideEffectCtx: SideEffectContext = {
    state,
    dispatch,
    backend,
    renderer,
    themeId,
    setThemeId,
    activeTab,
    clearIdleTimer,
    clearStartupGrace,
    startStartupGrace,
    getCurrentSessionProjectPath: () => {
      if (!state.currentSessionId) return undefined
      return state.sessions.find((s) => s.id === state.currentSessionId)?.projectPath
    },
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
        executeSideEffect(effect, sideEffectCtx)
      }
    }

    for (const effect of result.effects) {
      executeSideEffect(effect, sideEffectCtx)
    }
  }

  useKeyboard((key) => {
    // Global quit: Ctrl+C in any mode except terminal-input
    if (key.ctrl && key.name === 'c' && state.focusMode !== 'terminal-input') {
      key.preventDefault()
      executeSideEffect({ type: 'quit', state }, sideEffectCtx)
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
      onPaneActivate={handlePaneActivate}
      onSplitResize={handleSplitResize}
      onSeparatorDragStart={handleSeparatorDragStart}
      onSeparatorDrag={handleSeparatorDrag}
      onSeparatorDragEnd={handleSeparatorDragEnd}
      terminalCols={terminalSize.cols}
      terminalRows={terminalSize.rows}
    />
  )
}
