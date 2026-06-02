import {
  type ResolvedConfig,
  setAutoCommitEnabled,
  setExternalEditorConfig,
  setMultiRepoConfig,
  setStatusBarSeparator,
} from '@brimveyn/aimux-config'
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { KeyChord } from './input/keymap/key-chord'
import type { TrieBinding } from './input/keymap/trie'
import type { KeyResult, ModeContext, ModeId } from './input/modes/types'
import type { TerminalContentOrigin } from './input/raw-input-handler'
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
import { ensureClaudeSettingsHooks } from './integrations/claude-hooks-install'
import { highlightSnapshot, warmClaudeSyntaxOverlay } from './integrations/claude-syntax-overlay'
import { ensureClaudeSettingsThemePref, syncClaudeTheme } from './integrations/claude-theme-sync'
import { getProfileConfigDir, getProfileName } from './profile-paths'
import { startAIUsageService } from './services/ai-usage/provider'
import { aiUsageStore } from './state/ai-usage-store'
import { appStore, useAppStore } from './state/app-store'
import { setActiveDispatch, setActiveSideEffectRunner } from './state/dispatch-ref'
import { findMostRecentSession, loadSessionCatalog } from './state/session-catalog'
import { getSessionProjectPath } from './state/session-worktrees'
import { loadSnippetCatalog, mergeConfigSnippets } from './state/snippet-catalog'
import { createInitialState } from './state/store'
import { KeymapContext } from './ui/keymap-context'
import { RootView } from './ui/root'
import {
  applyTheme,
  getCurrentMode,
  getCurrentTheme,
  setMode,
  setTransparent,
  subscribeThemeChanges,
} from './ui/theme'
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
  setMultiRepoConfig(resolvedConfig.multiRepo)
  setExternalEditorConfig(resolvedConfig.externalEditor)
  setStatusBarSeparator(resolvedConfig.statusBar?.separator)

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
    const persisted =
      config.themeId != null && config.themeId !== '' && isKnownThemeId(config.themeId)
        ? config.themeId
        : undefined
    const initial: ThemeId = persisted ?? resolvedConfig.theme?.initialId ?? 'aimux'
    applyTheme(initial)
    if (resolvedConfig.theme?.initialMode) setMode(resolvedConfig.theme.initialMode)
    if (config.themeMode) setMode(config.themeMode)
    setTransparent(config.themeTransparent ?? false)
    return initial
  })
  // Initialize zustand store with computed initial state on first render. Using
  // useState's lazy initializer guarantees this runs exactly once before any
  // selector reads. We discard the value — the store is the source of truth.
  useState(() => {
    const json = loadConfig()
    const sessionBarVisible =
      resolvedConfig.sessionBar?.initialVisible ?? json.sessionBarVisible ?? true
    const sidebarOverrides = json.sidebar

    // Merge config-file gitPane (persisted prefs) with user's resolved gitPane
    // (programmatic config). User config wins; file provides persisted prior state.
    const userGitPane = resolvedConfig.gitPane
    const fileListMode = userGitPane?.initialFileListMode ?? json.gitPane?.fileListMode ?? 'tree'
    const diffModeRatio = userGitPane?.initialDiffModeRatio ?? json.gitPane?.diffModeRatio ?? 0.35
    const treeCompaction =
      userGitPane?.initialTreeCompaction ?? json.gitPane?.treeCompaction ?? true
    const prefetchRadius = userGitPane?.prefetchRadius ?? json.gitPane?.prefetchRadius ?? 5
    const persistedPaneRatio = json.gitPane?.paneRatio ?? json.gitPane?.ratio ?? 0.5
    const persistedEmbeddedRatio = json.gitPane?.embeddedRatio ?? json.gitPane?.ratio ?? 0.5
    const gitPaneOverrides = {
      ...json.gitPane,
      diffModeRatio,
      embeddedRatio:
        userGitPane?.initialMode === 'embedded' && userGitPane?.initialRatio !== undefined
          ? userGitPane.initialRatio
          : persistedEmbeddedRatio,
      fileListMode,
      paneRatio:
        userGitPane?.initialMode === 'pane' && userGitPane?.initialRatio !== undefined
          ? userGitPane.initialRatio
          : persistedPaneRatio,
      prefetchRadius,
      treeCompaction,
      ...(userGitPane?.initialVisible !== undefined ? { visible: userGitPane.initialVisible } : {}),
      ...(userGitPane?.initialMode !== undefined ? { mode: userGitPane.initialMode } : {}),
      ...(userGitPane?.initialPosition !== undefined
        ? { position: userGitPane.initialPosition }
        : {}),
      ...(userGitPane?.initialDiffModeRatio !== undefined
        ? { diffModeRatio: userGitPane.initialDiffModeRatio }
        : {}),
      ...(userGitPane?.path !== undefined ? { path: userGitPane.path } : {}),
      ...(userGitPane?.diffCount !== undefined ? { diffCount: userGitPane.diffCount } : {}),
    }

    const sessionCatalog = loadSessionCatalog()
    const mergedSnippets = mergeConfigSnippets(loadSnippetCatalog(), resolvedConfig.snippets)
    const initial = createInitialState(
      json.customCommands,
      sessionCatalog,
      mergedSnippets,
      sessionCatalog.length === 0,
      {
        gitPane: gitPaneOverrides,
        sessionBarVisible,
        sidebar: sidebarOverrides,
      }
    )
    // Replace the module-level default with the fully-resolved initial state.
    // Preserves the dispatch baked into the store by app-store.ts.
    appStore.setState(initial)
    const mostRecent = findMostRecentSession(sessionCatalog)
    if (mostRecent) {
      appStore.getState().dispatch({
        sessionId: mostRecent.id,
        type: 'load-session',
        workspaceSnapshot: mostRecent.workspaceSnapshot,
      })
    }
    return null
  })

  // Single source of truth: read state from zustand. The selector returns the
  // entire store object, so this component re-renders on every dispatch (same
  // cadence as the previous useReducer setup), but selectors elsewhere only
  // re-render on the slices they actually subscribe to.
  const state = useAppStore((s) => s)
  const dispatch = state.dispatch

  useLayoutEffect(() => {
    setActiveDispatch(dispatch)
    return () => {
      setActiveDispatch(null)
      setActiveSideEffectRunner(null)
    }
  }, [dispatch])

  useEffect(() => {
    if (!(resolvedConfig.theme?.beta?.harmonizeClaudeTheme === true)) return
    ensureClaudeSettingsThemePref()
    syncClaudeTheme(getCurrentTheme(), getCurrentMode())
    return subscribeThemeChanges((resolved, mode) => {
      syncClaudeTheme(resolved, mode)
    })
  }, [resolvedConfig.theme?.beta?.harmonizeClaudeTheme])

  useEffect(() => {
    // Opt-in via `integrations.claudeHooks` in aimux.config.ts. When enabled,
    // idempotently patches ~/.claude/settings.json so Claude Code's hooks
    // call back into the daemon for per-tab activity detection. Silent on
    // failure; the visual PTY detector is the fallback either way.
    if (resolvedConfig.integrations.claudeHooks) {
      ensureClaudeSettingsHooks()
    }
  }, [resolvedConfig.integrations.claudeHooks])

  useEffect(() => {
    const aiUsage = resolvedConfig.statusBar?.aiUsage
    if (!(aiUsage?.enabled === true)) {
      aiUsageStore.getState().setEnabled(false)
      return
    }
    aiUsageStore.getState().setEnabled(true)
    const handle = startAIUsageService(aiUsage, (snap) => {
      aiUsageStore.getState().setSnapshot(snap)
    })
    return () => {
      handle.stop()
      aiUsageStore.getState().clear()
      aiUsageStore.getState().setEnabled(false)
    }
  }, [resolvedConfig.statusBar?.aiUsage])

  useEffect(() => {
    if (process.env.AIMUX_DISABLE_UPDATE_CHECK === '1') return
    if (getProfileName() === 'dev') return

    let cancelled = false
    void (async () => {
      const [current, latest] = await Promise.all([
        getCurrentPackageVersion(),
        fetchLatestNpmVersion('@brimveyn/aimux'),
      ])
      if (cancelled || !(latest != null && latest !== '')) return
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
    // dispatch is stable (same fn reference from the store) — safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const stateRef = useRef(state)
  stateRef.current = state

  const snippetsRef = useRef(state.snippets)
  snippetsRef.current = state.snippets
  const branchRef = useRef(state.gitPanel.branch)
  branchRef.current = state.gitPanel.branch
  const triggerCharRef = useRef(resolvedConfig.snippetTriggerChar)
  triggerCharRef.current = resolvedConfig.snippetTriggerChar

  const contentOriginRef = useRef<TerminalContentOrigin>({ cols: 0, rows: 0, x: 0, y: 0 })
  const currentSessionWorkspaceSnapshot = currentSession?.workspaceSnapshot

  const syntaxOverlayFlag = resolvedConfig.theme?.beta?.experimentalSyntaxHighlight === true
  const syntaxOverlayFlagRef = useRef(syntaxOverlayFlag)
  syntaxOverlayFlagRef.current = syntaxOverlayFlag
  const syntaxOverlayEnabled = useCallback(() => syntaxOverlayFlagRef.current, [])

  useEffect(() => {
    if (!syntaxOverlayFlag) return
    let cancelled = false
    void (async () => {
      await warmClaudeSyntaxOverlay()
      if (cancelled) return
      // Re-apply the overlay to viewports that were dispatched before shiki
      // finished loading, so colors appear without waiting for the next
      // PTY data event.
      const snapshot = appStore.getState()
      for (const tab of snapshot.tabs) {
        if (!tab.viewport) continue
        dispatch({
          source: 'data',
          tabId: tab.id,
          terminalModes: tab.terminalModes,
          type: 'replace-tab-viewport',
          viewport: highlightSnapshot(tab.viewport, tab.id),
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [dispatch, syntaxOverlayFlag])

  const { clearIdleTimer, clearStartupGrace, startStartupGrace } = useBackendRuntime({
    activeTabId: state.activeTabId,
    backend,
    currentSessionId: state.currentSessionId,
    currentSessionWorkspaceSnapshot,
    dispatch,
    layoutRef,
    resizingRef,
    syntaxOverlayEnabled,
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
    handleEmbeddedGitResizeStart,
    handleGitPaneResizeStart,
    handlePaneActivate,
    handleSeparatorDrag,
    handleSeparatorDragEnd,
    handleSeparatorDragStart,
    handleSidebarResizeStart,
    handleSplitResize,
    handleTerminalClick,
    handleTerminalDrag,
    handleTerminalMouseEvent,
    handleTerminalMouseUp,
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
    branchRef,
    dispatch,
    focusMode: state.focusMode,
    focusModeRef,
    handleTerminalShortcut,
    renderer,
    snippetsRef,
    triggerCharRef,
  })

  const sideEffectCtx: SideEffectContext = {
    activeTab,
    backend,
    clearIdleTimer,
    clearStartupGrace,
    dispatch,
    getCurrentSessionProjectPath: () => {
      if (!(state.currentSessionId != null && state.currentSessionId !== '')) return
      return getSessionProjectPath(state.sessions.find((s) => s.id === state.currentSessionId))
    },
    // Read straight from the store, not stateRef. stateRef is only refreshed
    // on render, so within a single JS turn (a click handler that dispatches
    // then fires a side effect) it lags one step behind. appStore.getState
    // reflects every dispatch synchronously.
    getState: () => appStore.getState(),
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
        onTerminalDrag={handleTerminalDrag}
        onTerminalMouseUp={handleTerminalMouseUp}
        onPaneActivate={handlePaneActivate}
        onSplitResize={handleSplitResize}
        onEmbeddedGitResizeStart={handleEmbeddedGitResizeStart}
        onGitPaneResizeStart={handleGitPaneResizeStart}
        onSeparatorDragStart={handleSeparatorDragStart}
        onSeparatorDrag={handleSeparatorDrag}
        onSeparatorDragEnd={handleSeparatorDragEnd}
        onSidebarResizeStart={handleSidebarResizeStart}
        onMeasure={terminalSize.onMeasure}
        terminalCols={terminalSize.cols}
        terminalRows={terminalSize.rows}
      />
    </KeymapContext.Provider>
  )
}
