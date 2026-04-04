import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react'
import { useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'

import type { KeyResult, ModeContext, ModeId } from './input/modes/types'
import type { SessionBackend } from './session-backend/types'
import type { ThemeId } from './ui/themes'

import { executeSideEffect, type SideEffectContext } from './app-runtime/side-effects'
import { useBackendRuntime } from './app-runtime/use-backend-runtime'
import { useDirectorySearch } from './app-runtime/use-directory-search'
import { useMouseHandlers } from './app-runtime/use-mouse-handlers'
import { useRendererBindings } from './app-runtime/use-renderer-bindings'
import { useTerminalResize } from './app-runtime/use-terminal-resize'
import { useWorkspaceAutosave } from './app-runtime/use-workspace-autosave'
import { loadConfig } from './config'
import { deriveModeId } from './input/modes/bridge'
import { registerAllModes } from './input/modes/handlers'
import { getHandler, transitionTo } from './input/modes/registry'
import { type TerminalContentOrigin } from './input/raw-input-handler'
import { appStore } from './state/app-store'
import { loadSessionCatalog } from './state/session-catalog'
import { loadSnippetCatalog } from './state/snippet-catalog'
import { appReducer, createInitialState } from './state/store'
import { RootView } from './ui/root'
import { applyTheme } from './ui/theme'

registerAllModes()

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

  useLayoutEffect(() => {
    appStore.setState(state)
  }, [state])

  const resizingRef = useRef(false)
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

  const terminalSize = useTerminalResize({
    state,
    dispatch,
    backend,
    dimensions,
    contentOriginRef,
    resizingRef,
  })

  const {
    handleTerminalMouseEvent,
    handleTerminalScrollEvent,
    handleTerminalClick,
    handlePaneActivate,
    handleSplitResize,
    handleSeparatorDragStart,
    handleSeparatorDrag,
    handleSeparatorDragEnd,
  } = useMouseHandlers({
    state,
    dispatch,
    backend,
    renderer,
    activeMouseForwardingEnabled,
    activeLocalScrollbackEnabled,
  })

  useRendererBindings({
    backend,
    renderer,
    dispatch,
    focusMode: state.focusMode,
    activeTabId: state.activeTabId,
    focusModeRef,
    activeTabIdRef,
    activeTabRef,
    contentOriginRef,
  })

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
