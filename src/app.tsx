import { type ResolvedConfig, setAutoCommitEnabled } from '@brimveyn/aimux-config'
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'

import type { KeyChord } from './input/keymap/key-chord'
import type { TrieBinding } from './input/keymap/trie'
import type { KeyResult, ModeContext, ModeId } from './input/modes/types'
import type { SessionBackend } from './session-backend/types'

import { executeSideEffect, type SideEffectContext } from './app-runtime/side-effects'
import { useAutoCommitDriver } from './app-runtime/use-auto-commit-driver'
import { useBackendRuntime } from './app-runtime/use-backend-runtime'
import { useDirectorySearch } from './app-runtime/use-directory-search'
import { useMouseHandlers } from './app-runtime/use-mouse-handlers'
import { useRendererBindings } from './app-runtime/use-renderer-bindings'
import { useTerminalResize } from './app-runtime/use-terminal-resize'
import { useWorkspaceAutosave } from './app-runtime/use-workspace-autosave'
import { loadConfig } from './config'
import { setActiveKeymap } from './input/keymap/keymap-ref'
import { deriveModeId } from './input/modes/bridge'
import { registerAllModes } from './input/modes/handlers'
import { getHandler, transitionTo } from './input/modes/registry'
import { type TerminalContentOrigin } from './input/raw-input-handler'
import { getProfileConfigDir, getProfileName } from './profile-paths'
import { appStore } from './state/app-store'
import { setActiveDispatch, setActiveSideEffectRunner } from './state/dispatch-ref'
import { loadSessionCatalog } from './state/session-catalog'
import { loadSnippetCatalog } from './state/snippet-catalog'
import { appReducer, createInitialState } from './state/store'
import { KeymapContext } from './ui/keymap-context'
import { RootView } from './ui/root'
import { applyTheme, setTransparent } from './ui/theme'
import { isKnownThemeId, type ThemeId } from './ui/themes'
import {
  fetchLatestNpmVersion,
  getCurrentPackageVersion,
  isNewerVersion,
} from './update/version-check'

const WORKSPACE_SAVE_DEBOUNCE_MS = 250

export function App({
  backend,
  resolvedConfig,
}: {
  backend: SessionBackend
  resolvedConfig: ResolvedConfig
}) {
  // Publish the auto-commit enabled flag before any children render so
  // actions (which live outside React) can read it synchronously.
  setAutoCommitEnabled(resolvedConfig.autoCommit.enabled)

  const keymapHandlers = useMemo(
    () => {
      setActiveKeymap(resolvedConfig.keymaps)
      return registerAllModes(resolvedConfig.keymaps)
    },
    // Registration has side effects in a global mode registry — run once per app instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const [themeId, setThemeId] = useState<ThemeId>(() => {
    const config = loadConfig()
    const persisted = config.themeId && isKnownThemeId(config.themeId) ? config.themeId : undefined
    const fromConfig: ThemeId =
      resolvedConfig.theme?.mode === 'light' ? 'aimux-light' : 'aimux-dark'
    const initial: ThemeId = persisted ?? fromConfig
    applyTheme(initial, resolvedConfig.theme?.paletteOverrides)
    setTransparent(config.themeTransparent ?? false)
    return initial
  })
  const [state, dispatch] = useReducer(appReducer, undefined, () => {
    const json = loadConfig()
    const sessionBarVisible = resolvedConfig.sessionBar?.visible ?? json.sessionBarVisible ?? true
    const sessionBarPosition =
      resolvedConfig.sessionBar?.position ?? json.sessionBarPosition ?? 'top'

    // Merge config-file gitPane (persisted prefs) with user's resolved gitPane
    // (programmatic config). User config wins; file provides persisted prior state.
    const userGitPane = resolvedConfig.gitPane
    const fileListMode = userGitPane?.fileListMode ?? json.gitPane?.fileListMode ?? 'tree'
    const diffModeRatio = userGitPane?.diffModeRatio ?? json.gitPane?.diffModeRatio ?? 0.35
    const treeCompaction = userGitPane?.treeCompaction ?? json.gitPane?.treeCompaction ?? true
    const prefetchRadius = userGitPane?.prefetchRadius ?? json.gitPane?.prefetchRadius ?? 5
    const gitPaneOverrides = {
      ...json.gitPane,
      diffModeRatio,
      fileListMode,
      prefetchRadius,
      treeCompaction,
      ...(userGitPane?.visible !== undefined ? { visible: userGitPane.visible } : {}),
      ...(userGitPane?.mode !== undefined ? { mode: userGitPane.mode } : {}),
      ...(userGitPane?.position !== undefined ? { position: userGitPane.position } : {}),
      ...(userGitPane?.ratio !== undefined ? { ratio: userGitPane.ratio } : {}),
      ...(userGitPane?.diffModeRatio !== undefined
        ? { diffModeRatio: userGitPane.diffModeRatio }
        : {}),
      ...(userGitPane?.path !== undefined ? { path: userGitPane.path } : {}),
      ...(userGitPane?.diffCount !== undefined ? { diffCount: userGitPane.diffCount } : {}),
    }

    return createInitialState(
      json.customCommands,
      loadSessionCatalog(),
      loadSnippetCatalog(),
      true,
      {
        gitPane: gitPaneOverrides,
        sessionBarPosition,
        sessionBarVisible,
      }
    )
  })

  useLayoutEffect(() => {
    appStore.setState(state)
  }, [state])

  useLayoutEffect(() => {
    setActiveDispatch(dispatch)
    return () => {
      setActiveDispatch(null)
      setActiveSideEffectRunner(null)
    }
  }, [dispatch])

  useEffect(() => {
    if (process.env.AIMUX_DISABLE_UPDATE_CHECK === '1') return
    if (getProfileName() === 'dev') return

    let cancelled = false
    void (async () => {
      const [current, latest] = await Promise.all([
        getCurrentPackageVersion(),
        fetchLatestNpmVersion('@brimveyn/aimux'),
      ])
      if (cancelled || !latest) return
      if (!isNewerVersion(latest, current)) return
      if (loadConfig().skippedUpdateVersion === latest) return
      dispatch({
        currentVersion: current,
        latestVersion: latest,
        type: 'open-update-available-modal',
      })
    })()

    return () => {
      cancelled = true
    }
  }, [])

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
  const activeTabScrollIntentRef = useRef(activeTab?.scrollIntent ?? null)
  activeTabScrollIntentRef.current = activeTab?.scrollIntent ?? null

  const stateRef = useRef(state)
  stateRef.current = state

  const contentOriginRef = useRef<TerminalContentOrigin>({ cols: 0, rows: 0, x: 0, y: 0 })
  const currentSessionWorkspaceSnapshot = currentSession?.workspaceSnapshot

  const { clearIdleTimer, clearStartupGrace, startStartupGrace } = useBackendRuntime({
    activeTabId: state.activeTabId,
    activeTabScrollIntentRef,
    backend,
    currentSessionId: state.currentSessionId,
    currentSessionWorkspaceSnapshot,
    dispatch,
    layoutRef,
    resizingRef,
  })

  useWorkspaceAutosave(state, WORKSPACE_SAVE_DEBOUNCE_MS)
  useDirectorySearch(state.modal, dispatch)
  useAutoCommitDriver({
    config: resolvedConfig.autoCommit,
    dispatch,
    getProfileConfigRoot: getProfileConfigDir,
    state,
    stateRef,
  })

  const terminalSize = useTerminalResize({
    backend,
    contentOriginRef,
    dimensions,
    dispatch,
    resizingRef,
    state,
  })

  const {
    handlePaneActivate,
    handleSeparatorDrag,
    handleSeparatorDragEnd,
    handleSeparatorDragStart,
    handleSplitResize,
    handleTerminalClick,
    handleTerminalMouseEvent,
    handleTerminalScrollEvent,
  } = useMouseHandlers({
    activeLocalScrollbackEnabled,
    activeMouseForwardingEnabled,
    backend,
    dispatch,
    renderer,
    state,
  })

  // Stable ref to processKeyResult — populated after it is defined below.
  // Allows handleTerminalShortcut (a stable callback) to reach the latest closure.
  const processKeyResultRef = useRef<(result: KeyResult, modeId: ModeId) => void>(() => {})

  const handleTerminalShortcut = useCallback(
    (chord: KeyChord): boolean => {
      const terminalHandler = keymapHandlers.find((h) => h.id === 'terminal-input')
      if (!terminalHandler) return false
      const ctx: ModeContext = { state: stateRef.current }
      const result = terminalHandler.handleChord(chord, ctx)
      if (!result) return false
      processKeyResultRef.current(result, 'terminal-input')
      return true
    },
    [keymapHandlers]
  )

  useRendererBindings({
    activeTabId: state.activeTabId,
    activeTabIdRef,
    activeTabRef,
    activeTabViewportY: activeTab?.viewport?.viewportY ?? null,
    backend,
    dispatch,
    focusMode: state.focusMode,
    focusModeRef,
    handleTerminalShortcut,
    renderer,
  })

  const sideEffectCtx: SideEffectContext = {
    activeTab,
    backend,
    clearIdleTimer,
    clearStartupGrace,
    dispatch,
    getCurrentSessionProjectPath: () => {
      if (!state.currentSessionId) return undefined
      return state.sessions.find((s) => s.id === state.currentSessionId)?.projectPath
    },
    renderer,
    setThemeId,
    startStartupGrace,
    state,
    themeId,
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

  // Keep the ref pointing at the latest closure so stable callbacks can invoke it
  processKeyResultRef.current = processKeyResult
  // Expose the side-effect runner so non-keyboard call sites (mouse, IPC) can
  // invoke the same effect pipeline with the current context.
  setActiveSideEffectRunner((effect) => executeSideEffect(effect, sideEffectCtx))

  useLayoutEffect(() => {
    for (const handler of keymapHandlers) {
      handler.setTimeoutCallback((binding: TrieBinding) => {
        const currentState = stateRef.current
        const modeId = deriveModeId(currentState)
        if (modeId !== handler.id) return // mode changed during timeout
        const ctx: ModeContext = { state: currentState }
        const result = typeof binding.result === 'function' ? binding.result(ctx) : binding.result
        if (result) processKeyResultRef.current(result, modeId)
      })

      handler.setPendingChangeCallback((chords) => {
        dispatch({ chords, type: 'set-pending-chords' })
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useKeyboard((key) => {
    const currentState = stateRef.current
    // Global quit: Ctrl+C in any mode except terminal-input
    if (key.ctrl && key.name === 'c' && currentState.focusMode !== 'terminal-input') {
      key.preventDefault()
      executeSideEffect({ state: currentState, type: 'quit' }, sideEffectCtx)
      return
    }

    const modeId = deriveModeId(currentState)
    const handler = getHandler(modeId)
    if (!handler) return

    const ctx: ModeContext = { state: currentState }
    const result = handler.handleKey(key, ctx)
    if (!result) return

    key.preventDefault()
    processKeyResult(result, modeId)
  })

  return (
    <KeymapContext.Provider value={resolvedConfig.keymaps}>
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
    </KeymapContext.Provider>
  )
}
