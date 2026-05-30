import type { ServerWebSocket } from 'bun'

import {
  setAutoCommitEnabled,
  setExternalEditorConfig,
  setMultiRepoConfig,
} from '@brimveyn/aimux-config'
import { connect } from 'node:net'
import { basename } from 'node:path'

import type { LayoutState } from '../state/types'

import { version as APP_VERSION } from '../../package.json'
import { attachCurrentSession } from '../app-runtime/backend-attach-runtime'
import { bindBackendRuntimeEvents } from '../app-runtime/backend-runtime-events'
import {
  createSessionFromCurrentState,
  handleCreateSessionEffect,
  handleDeleteSessionEffect,
  handleSwitchSessionEffect,
} from '../app-runtime/session-actions'
import { resizeSplitTabs } from '../app-runtime/use-terminal-resize'
import { startWorkspaceAutosave } from '../app-runtime/use-workspace-autosave'
import { loadConfig } from '../config'
import { loadUserConfig } from '../config/loader'
import { logDebug } from '../debug/input-log'
import { startDiffOnDemandPipeline } from '../git/diff-orchestration'
import { startGitPanelPolling } from '../git/git-poller'
import { startWorktreeDivergencePolling } from '../git/worktree-divergence-poller'
import { setActiveKeymap } from '../input/keymap/keymap-ref'
import { registerAllModes } from '../input/modes/handlers'
import { ensureClaudeSettingsThemePref, syncClaudeTheme } from '../integrations/claude-theme-sync'
import { getProfileName } from '../profile-paths'
import { startAIUsageService } from '../services/ai-usage/provider'
import { createSessionBackend } from '../session-backend/bootstrap'
import { aiUsageStore } from '../state/ai-usage-store'
import { appStore } from '../state/app-store'
import { setActiveDispatch, setActiveSideEffectRunner } from '../state/dispatch-ref'
import { gitFileKey } from '../state/git-tree'
import {
  findMostRecentSession,
  loadSessionCatalog,
  saveSessionCatalog,
} from '../state/session-catalog'
import { getSessionProjectPath } from '../state/session-worktrees'
import { loadSnippetCatalog, mergeConfigSnippets } from '../state/snippet-catalog'
import { createInitialState } from '../state/store'
import { getStatusBarModel } from '../ui/status-bar-model'
import {
  applyTheme,
  getCurrentMode,
  getCurrentTheme,
  getCurrentThemeId,
  getTransparent,
  setMode,
  setTransparent,
  subscribeThemeChanges,
} from '../ui/theme'
import { isKnownThemeId, type ThemeId } from '../ui/themes'
import {
  fetchLatestNpmVersion,
  getCurrentPackageVersion,
  isNewerVersion,
} from '../update/version-check'
import { startDiffPrefetchDriver } from './diff-prefetch-driver'
import { createDirectorySearchRunner } from './gui-directory-search'
import { computeGuiHelpEntries } from './gui-help-entries'
import { createPipeline } from './host-pipeline'
import { createStubRenderer, createTabTimeouts } from './host-side-effect-ctx'
import { launchShell } from './launch-shell'
import { startMultiRepoDiscoveryDriver } from './multi-repo-discovery-driver'
import { type GuiServerMessage, parseClientMessage, PROTOCOL_VERSION } from './protocol'
import { createSnippetTriggerDriver } from './snippet-trigger-driver'
import { projectAppState } from './state-projection'

const GUI_PORT = 7878

export async function runGui(): Promise<void> {
  // The GUI streams raw PTY bytes to a client-side xterm.js for pixel-perfect
  // rendering. The daemon now forwards a `tabBytes` event when a client opts
  // in via `setBytesEnabled` (`RemoteSessionBackend` does that automatically
  // when constructed with `streamBytes: true`). PTYs live in the shared
  // terminal-manager process and survive GUI restarts — same model as the
  // TUI, so switching between the two preserves all live sessions.
  //
  // `AIMUX_LOCAL_BACKEND=1` still forces the in-process backend for tests/dev
  // (honored by `createSessionBackend`); it is no longer the default.

  const resolvedConfig = await loadUserConfig()
  setAutoCommitEnabled(resolvedConfig.autoCommit.enabled)
  setMultiRepoConfig(resolvedConfig.multiRepo)
  setExternalEditorConfig(resolvedConfig.externalEditor)

  const json = loadConfig()

  // Theme singleton (used by status-bar-model etc.); the browser also re-resolves.
  const persisted =
    json.themeId != null && json.themeId !== '' && isKnownThemeId(json.themeId)
      ? json.themeId
      : undefined
  let themeId: ThemeId = persisted ?? resolvedConfig.theme?.initialId ?? 'aimux'
  applyTheme(themeId)
  if (resolvedConfig.theme?.initialMode) {
    setMode(resolvedConfig.theme.initialMode)
  }
  if (json.themeMode) {
    setMode(json.themeMode)
  }
  setTransparent(json.themeTransparent ?? false)

  // Cleanup slots — declared up front so any boot-time subscriber (e.g. the
  // Claude-theme sync below) can stash its disposer. Slots populated lazily
  // further down (autosave / diff / divergence / multi-repo / panel) just
  // mutate this object; assignment order doesn't matter, only that the
  // declaration is in source order before the first write.
  const disposers: {
    autosave: (() => void) | null
    claudeThemeSync: (() => void) | null
    diff: (() => void) | null
    diffPrefetch: (() => void) | null
    divergence: (() => void) | null
    multiRepo: (() => void) | null
    panel: (() => void) | null
  } = {
    autosave: null,
    claudeThemeSync: null,
    diff: null,
    diffPrefetch: null,
    divergence: null,
    multiRepo: null,
    panel: null,
  }

  // Claude Code theme harmonisation (beta) — port of src/app.tsx:186-193.
  // Writes ~/.claude/themes/aimux.json once at boot and on every theme change
  // so Claude Code's watcher picks up the live aimux theme. No-op when the
  // beta flag is off.
  if (resolvedConfig.theme?.beta?.harmonizeClaudeTheme === true) {
    ensureClaudeSettingsThemePref()
    syncClaudeTheme(getCurrentTheme(), getCurrentMode())
    disposers.claudeThemeSync = subscribeThemeChanges((resolved, mode) => {
      syncClaudeTheme(resolved, mode)
    })
  }

  // Initial AppState (port of app.tsx's lazy init, trimmed for the GUI).
  let sessionCatalog = loadSessionCatalog()
  const mergedSnippets = mergeConfigSnippets(loadSnippetCatalog(), resolvedConfig.snippets)
  const initial = createInitialState(json.customCommands, sessionCatalog, mergedSnippets, false, {
    sessionBarPosition:
      resolvedConfig.sessionBar?.initialPosition ?? json.sessionBarPosition ?? 'top',
    sessionBarVisible: resolvedConfig.sessionBar?.initialVisible ?? json.sessionBarVisible ?? true,
    sidebar: json.sidebar,
  })
  appStore.setState(initial)

  const dispatch = appStore.getState().dispatch
  const getState = () => appStore.getState()

  // Resolve the initial session: most recent, else a fresh one for the cwd.
  let initialSession = findMostRecentSession(sessionCatalog)
  if (initialSession === undefined) {
    const cwd = process.cwd()
    const created = createSessionFromCurrentState(getState(), basename(cwd) || cwd, cwd)
    sessionCatalog = created.sessions
    saveSessionCatalog(sessionCatalog)
    dispatch({ sessions: sessionCatalog, type: 'set-sessions' })
    initialSession = created.session
  }
  dispatch({
    sessionId: initialSession.id,
    type: 'load-session',
    workspaceSnapshot: initialSession.workspaceSnapshot,
  })

  const backend = await createSessionBackend({ streamBytes: true })
  const isLocalBackend = process.env.AIMUX_LOCAL_BACKEND === '1'

  // Reap every PTY when the host goes away — but only in local-backend mode.
  // With the daemon, PTYs live in terminal-manager and must survive a GUI
  // exit so reopening the GUI (or the TUI) reattaches to the live state.
  // Calling disposeAll() against the daemon would tear every session down,
  // which is exactly the behaviour this rework is meant to eliminate.
  let backendDisposed = false
  let stopAIUsage: (() => void) | null = null
  const disposeBackend = (): void => {
    if (backendDisposed) {
      return
    }
    backendDisposed = true
    stopAIUsage?.()
    if (isLocalBackend) {
      backend.disposeAll()
    }
  }
  // Flush the workspace-autosave disposer on signal exits so any pending
  // debounced save lands on disk before we die. Otherwise a tab created
  // within the 250ms window vanishes from the snapshot — the daemon still
  // has the live PTY, but the GUI can't preserve its layout/title across
  // restarts. Defined here so the signal handlers can reach it; assigned
  // below once `disposers.autosave` is set up.
  const flushAutosave = (): void => {
    try {
      disposers.autosave?.()
      disposers.autosave = null
    } catch {
      // Best-effort: failing to flush shouldn't block shutdown.
    }
  }
  let updateCheckCancelled = false
  const shutdown = async (signal: string): Promise<void> => {
    logDebug('gui.host.shutdown', { signal })
    updateCheckCancelled = true
    disposers.claudeThemeSync?.()
    // Abort any in-flight prefetch work so the queue doesn't keep firing
    // git subprocesses while the host is tearing down.
    disposers.diffPrefetch?.()
    flushAutosave()
    disposeBackend()
    try {
      // Hard timeout so a hung IPC peer doesn't keep us from exiting; the
      // 200ms window is enough for a clean FIN on the daemon socket.
      await Promise.race([
        backend.destroy?.() ?? Promise.resolve(),
        new Promise((resolve) => setTimeout(resolve, 200)),
      ])
    } catch (error) {
      logDebug('gui.host.destroyFailed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    process.exit(0)
  }
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => {
      void shutdown(sig)
    })
  }

  setActiveKeymap(resolvedConfig.keymaps)
  const handlers = registerAllModes(resolvedConfig.keymaps)
  const helpEntries = computeGuiHelpEntries(resolvedConfig.keymaps)
  setActiveDispatch(dispatch)
  const directorySearch = createDirectorySearchRunner(dispatch)

  const timeouts = createTabTimeouts()
  const renderer = createStubRenderer()

  // Per-connection state for the single active WS client. Bundled together so
  // close/open lifecycle clears them as a unit and can't drift apart.
  interface ActiveWsState {
    ws: ServerWebSocket<unknown>
    // Token bucket for `requestBytes`: capacity 10, refill 10/s (1 per 100ms).
    // Sized to the frontend's mount pattern (one dump per fresh xterm), with
    // headroom for the StrictMode double-mount + brief re-mount bursts.
    requestBytesTokens: number
    requestBytesLastRefillMs: number
  }
  const REQUEST_BYTES_CAPACITY = 10
  const REQUEST_BYTES_REFILL_PER_SEC = 10
  let activeWs: ServerWebSocket<unknown> | null = null
  let activeWsState: ActiveWsState | null = null
  const send = (message: GuiServerMessage): void => {
    activeWs?.send(JSON.stringify(message))
  }
  const tryConsumeRequestBytesToken = (state: ActiveWsState): boolean => {
    const now = performance.now()
    const elapsed = now - state.requestBytesLastRefillMs
    if (elapsed > 0) {
      const refill = (elapsed / 1000) * REQUEST_BYTES_REFILL_PER_SEC
      if (refill > 0) {
        state.requestBytesTokens = Math.min(
          REQUEST_BYTES_CAPACITY,
          state.requestBytesTokens + refill
        )
        state.requestBytesLastRefillMs = now
      }
    }
    if (state.requestBytesTokens >= 1) {
      state.requestBytesTokens -= 1
      return true
    }
    return false
  }

  let broadcastScheduled = false
  const broadcastState = (): void => {
    const state = getState()
    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId)
    const usage = aiUsageStore.getState()
    send({
      projection: projectAppState(state, {
        // AI usage lives in a separate vanilla store (not AppState); ship its
        // current snapshots so the GUI status bar can render the indicator.
        aiUsage: { enabled: usage.enabled, snapshots: usage.snapshots },
        // `committedThemeId` is the saved id — used for the "(current)" marker so
        // it stays put while previewing. `themeId` is the LIVE theme (preview +
        // confirm/restore) and drives the renderer CSS.
        committedThemeId: themeId,
        helpEntries,
        // Reuse the TUI's status-bar model (left/right/help strings) so the GUI
        // renders identical content; it needs the keymap config the host owns.
        statusBar: {
          ...getStatusBarModel(state, activeTab, resolvedConfig.keymaps),
          version: APP_VERSION,
        },
        themeId: getCurrentThemeId(),
        themeMode: getCurrentMode(),
        transparent: getTransparent(),
      }),
      t: 'state',
    })
  }
  const scheduleBroadcast = (): void => {
    if (broadcastScheduled) {
      return
    }
    broadcastScheduled = true
    queueMicrotask(() => {
      broadcastScheduled = false
      broadcastState()
    })
  }

  // Mirror app.tsx's AI usage lifecycle: poll the configured tools and feed the
  // shared store; each snapshot triggers a rebroadcast so the GUI status bar
  // updates. The browser computes the live reset countdown locally.
  const aiUsageConfig = resolvedConfig.statusBar?.aiUsage
  if (aiUsageConfig?.enabled === true) {
    aiUsageStore.getState().setEnabled(true)
    const handle = startAIUsageService(aiUsageConfig, (snap) => {
      aiUsageStore.getState().setSnapshot(snap)
      scheduleBroadcast()
    })
    stopAIUsage = () => {
      handle.stop()
      aiUsageStore.getState().clear()
      aiUsageStore.getState().setEnabled(false)
    }
  }

  // Theme preview/confirm/restore all go through applyTheme on the singleton;
  // rebroadcast so the browser recolors live as the user moves in the picker.
  subscribeThemeChanges(() => scheduleBroadcast())

  const snippetDriver = createSnippetTriggerDriver({
    backend,
    getBranch: () => getState().gitPanel.branch,
    getSnippets: () => getState().snippets,
    getTab: (tabId) => getState().tabs.find((entry) => entry.id === tabId),
    getTriggerChar: () => resolvedConfig.snippetTriggerChar,
  })

  const pipeline = createPipeline({
    backend,
    beforeTerminalWrite: (tabId, bytes) => {
      // Backspace within the post-expansion window undoes the expansion.
      // Must run before the printable filter since DEL/\b are control
      // codes. Mirrors src/app-runtime/use-renderer-bindings.ts:157.
      if (snippetDriver.tryConsumeUndo(tabId, bytes)) return true
      // Snippet trigger detection: only react when the user typed exactly
      // one printable char. Multi-byte sequences (arrow keys, function
      // keys, escape sequences) bypass the detector and flow to PTY.
      if (bytes.length !== 1) return false
      const code = bytes.codePointAt(0) ?? 0
      // Skip control chars (0-31) and DEL (127) — only feed printables.
      if (code < 32 || code === 127) return false
      return snippetDriver.feedKey(tabId, bytes)
    },
    getThemeId: () => themeId,
    renderer,
    setThemeId: (id) => {
      themeId = id
      scheduleBroadcast()
    },
    timeouts,
  })
  pipeline.wireHandlerCallbacks(handlers)
  setActiveSideEffectRunner(pipeline.runEffect)

  // Bind backend events (render/exit/error/activity) into the store, exactly
  // like the TUI runtime. We don't call the returned cleanup (host lives on).
  const resizingRef = { current: false }
  bindBackendRuntimeEvents({
    backend,
    dispatch,
    resizingRef,
    syntaxOverlayEnabled: () => false,
    timeouts: {
      clearAllTimers: timeouts.clearAllTimers,
      clearIdleTimer: timeouts.clearIdleTimer,
      clearStartupGrace: timeouts.clearStartupGrace,
    },
  })

  // Serialize a tab's current scrollback as an ANSI dump and push it to the
  // client. Pull-based: the frontend xterm.js requests this on mount (one
  // request per fresh terminal instance) so the host never has to guess when a
  // dump is needed. This avoids the double-paint bug where pushing a dump into
  // an xterm that already holds the scrollback stacks duplicate splash screens.
  const sendBytesDump = async (tabId: string): Promise<void> => {
    let data = await backend.serializeBuffer(tabId)
    if (data === '') {
      // PTY not running for this tab (typically restored from a workspace
      // snapshot in 'disconnected' state). Fall back to the persisted ANSI
      // buffer so xterm.js rebuilds the visible scrollback — matches the
      // legacy DOM renderer behaviour. The user can press Ctrl+r to
      // actually respawn the PTY when they want to interact.
      const tab = getState().tabs.find((entry) => entry.id === tabId)
      data = tab?.buffer ?? ''
    }
    if (data !== '') {
      // Distinct from live `bytes`: the client RIS-resets its xterm before
      // writing this, so receiving the dump any number of times (StrictMode
      // double-mount, reconnect, …) converges to a single copy.
      send({ data, t: 'bytesReset', tabId })
    }
  }
  backend.on('bytes', (tabId, data) => {
    // Live PTY output for every tab — the GUI keeps a persistent xterm instance
    // per tab (alive across switches), so hidden tabs must stay current without
    // a re-dump. The initial scrollback still comes via the frontend's
    // requestBytes (one dump per instance creation).
    send({ data, t: 'bytes', tabId })
  })
  // Tab can die without a closeTab message (PTY crash, daemon eviction).
  // Drop the per-tab detector + in-flight guard so a recycled tabId doesn't
  // inherit stale state. The existing bindBackendRuntimeEvents call also
  // registers an 'exit' listener — multiple EventEmitter listeners are fine.
  backend.on('exit', (tabId) => {
    snippetDriver.dispose(tabId)
  })

  // React to session/active-tab changes (attach + setActiveTab), like the TUI runtime.
  const layoutRef: { current: LayoutState } = { current: getState().layout }
  const attachRequestIdRef = { current: 0 }
  let lastSessionId = getState().currentSessionId
  let lastActiveTabId = getState().activeTabId
  const attachSession = (sessionId: string): void => {
    const session = getState().sessions.find((entry) => entry.id === sessionId)
    attachCurrentSession({
      attachRequestIdRef,
      backend,
      currentSessionId: sessionId,
      currentSessionWorkspaceSnapshot: session?.workspaceSnapshot,
      dispatch,
      layoutRef,
    })
  }

  // Git pollers — the TUI runs these from React hooks (git-view, git-pane-widget,
  // sidebar). Without a React root in GUI mode they never start, so gitPanel.files
  // stays empty forever. Drive them from the host instead so the projection
  // mirrors the same data the TUI sees.
  //
  // Restart the panel poller whenever the inputs change (projectPath / headOffset
  // / repos). compareRef (review-vs-base fork point) needs an async git merge-base
  // resolution and is only meaningful in git focus mode — left as undefined for
  // Stage 2a (read-only panel). It will be wired in Stage 2b alongside the diff
  // viewer.
  const projectPathOf = (state: ReturnType<typeof getState>): string | undefined => {
    const id = state.currentSessionId
    const session = id != null && id !== '' ? state.sessions.find((s) => s.id === id) : undefined
    return getSessionProjectPath(session)
  }
  let lastPanelProjectPath = projectPathOf(getState())
  let lastPanelHeadOffset = getState().gitMode.headOffset
  let lastPanelRepos = getState().multiRepo.repos
  const restartPanelPoll = (): void => {
    disposers.panel?.()
    disposers.panel = startGitPanelPolling({
      enabled: true,
      getRepos: () => appStore.getState().multiRepo.repos,
      headOffset: lastPanelHeadOffset,
      projectPath: lastPanelProjectPath,
    })
  }
  let lastDivergenceSessionId = getState().currentSessionId
  let lastDivergenceSessions = getState().sessions
  // Prefetch driver tracks — the queue dedupes by key so we just need to
  // call `update()` whenever any input might have changed. These four
  // references cover all the hook's deps: `gitMode` carries selectedEntryKey
  // / diffs / parsed / loading / collapsedFolders / headOffset, `gitPanel`
  // carries files, `gitPane` carries radius / fileListMode / treeCompaction.
  let lastPrefetchProjectPath = projectPathOf(getState())
  let lastPrefetchGitMode = getState().gitMode
  let lastPrefetchGitPanel = getState().gitPanel
  let lastPrefetchGitPane = getState().gitPane
  const restartDivergencePoll = (): void => {
    disposers.divergence?.()
    disposers.divergence = startWorktreeDivergencePolling({
      enabled: true,
      getCurrentSessionId: () => appStore.getState().currentSessionId,
      getSessions: () => appStore.getState().sessions,
    })
  }
  const multiRepoDriver = startMultiRepoDiscoveryDriver({ dispatch })
  multiRepoDriver.update(lastPanelProjectPath)
  disposers.multiRepo = () => multiRepoDriver.dispose()
  restartPanelPoll()
  restartDivergencePoll()

  // Workspace autosave — TUI uses useWorkspaceAutosave (debounce 250ms) to
  // persist tabs/layout/gitPane on every state change. Same React-hook blocker
  // as the pollers: drive it from the host so the GUI restores the last
  // workspace snapshot on next launch.
  disposers.autosave = startWorkspaceAutosave({
    debounceMs: 250,
    getState: () => appStore.getState(),
    subscribe: (listener) => appStore.subscribe(listener),
  })

  // On-demand diff fetcher — pulls the diff for the currently selected entry
  // in git-mode. Subscribes to the store internally; same rationale as the
  // pollers above (no React root in GUI mode → React hook never runs).
  disposers.diff = startDiffOnDemandPipeline({
    enabled: true,
    getCachedDiff: (key) => appStore.getState().gitMode.diffs[key],
    // Stage 2c will wire review-vs-base; for now we always diff against HEAD~N.
    // Explicit `: undefined` annotation keeps the inferred return type aligned
    // with the orchestrator's `getCompareRef: () => string | undefined`.
    getCompareRef: (): string | undefined => {
      return undefined
    },
    getHeadOffset: () => appStore.getState().gitMode.headOffset,
    getProjectPath: () => projectPathOf(appStore.getState()),
    getSelectedFile: () => {
      const s = appStore.getState()
      const key = s.gitMode.selectedEntryKey
      if (key == null || key === '') return null
      return s.gitPanel.files.find((f) => gitFileKey(f) === key) ?? null
    },
    getSelectedKey: () => appStore.getState().gitMode.selectedEntryKey,
  })

  // Radius prefetch — fetches the diffs ±gitPane.prefetchRadius around the
  // selected entry so j/k-style navigation hits the cache. Mirrors the TUI's
  // `useDiffPrefetch` hook; both delegate to the shared `PrefetchQueue` in
  // `src/git/diff-prefetch-queue.ts`. The driver itself doesn't subscribe to
  // the store — the main `appStore.subscribe` below calls `update()` whenever
  // a tracked input changes (selection, files, radius, cache, …).
  const diffPrefetchDriver = startDiffPrefetchDriver({
    getCollapsedFolders: () => appStore.getState().gitMode.collapsedFolders,
    getCompareRef: (): string | undefined => undefined,
    getDiffs: () => appStore.getState().gitMode.diffs,
    getEnabled: () => true,
    getFileListMode: () => appStore.getState().gitPane.fileListMode,
    getFiles: () => appStore.getState().gitPanel.files,
    getHeadOffset: () => appStore.getState().gitMode.headOffset,
    getLoading: () => appStore.getState().gitMode.loading,
    getParsed: () => appStore.getState().gitMode.parsedFiles,
    getProjectPath: () => projectPathOf(appStore.getState()),
    getRadius: () => appStore.getState().gitPane.prefetchRadius,
    getSelectedKey: () => appStore.getState().gitMode.selectedEntryKey,
    getTreeCompaction: () => appStore.getState().gitPane.treeCompaction,
  })
  disposers.diffPrefetch = () => diffPrefetchDriver.dispose()
  // Kick the initial pass so a workspace that boots straight into a selected
  // entry warms the neighbours before the user starts pressing j/k.
  diffPrefetchDriver.update()

  // Resize cascade for hidden tabs — port of the TUI's useTerminalResize hook
  // (src/app-runtime/use-terminal-resize.ts). The frontend xterm.js panes
  // re-measure and push `resizeTab` only for VISIBLE panes; tabs the GUI keeps
  // alive but unmounted (background xterm registry) would stay stuck at their
  // last-applied PTY size until activated, rendering wrapped/clipped until the
  // next focus event. Mirror the TUI cascade so toggling sidebar/gitPane (or
  // any layout-tree mutation) propagates the new main-area size to every tab.
  //
  // `state.layout.terminalCols/Rows` is kept in sync by the `resizeTab` WS
  // handler above (single-leaf active tab) — only cascade once that's happened
  // at least once, otherwise we'd push the 80×24 default into every PTY.
  const initialLayout = getState().layout
  let lastLayoutCols = initialLayout.terminalCols
  let lastLayoutRows = initialLayout.terminalRows
  let lastSidebarVisible = getState().sidebar.visible
  let lastSidebarWidth = getState().sidebar.width
  let lastGitPaneMode = getState().gitPane.mode
  let lastGitPaneVisible = getState().gitPane.visible
  let lastGitPanePosition = getState().gitPane.position
  let lastGitPaneRatio = getState().gitPane.paneRatio
  let lastLayoutTrees = getState().layoutTrees
  let lastTabsRef = getState().tabs
  let terminalSizeKnown = false

  appStore.subscribe(() => {
    const state = getState()
    layoutRef.current = state.layout
    if (state.currentSessionId !== lastSessionId) {
      lastSessionId = state.currentSessionId
      if (state.currentSessionId !== null && state.currentSessionId !== '') {
        attachSession(state.currentSessionId)
      }
    }
    if (state.activeTabId !== lastActiveTabId) {
      lastActiveTabId = state.activeTabId
      if (state.currentSessionId !== null && state.currentSessionId !== '') {
        backend.setActiveTab(state.activeTabId)
      }
    }
    // Panel poller — restart when any of its inputs change.
    const nextPath = projectPathOf(state)
    const nextOffset = state.gitMode.headOffset
    const nextRepos = state.multiRepo.repos
    if (
      nextPath !== lastPanelProjectPath ||
      nextOffset !== lastPanelHeadOffset ||
      nextRepos !== lastPanelRepos
    ) {
      lastPanelProjectPath = nextPath
      lastPanelHeadOffset = nextOffset
      lastPanelRepos = nextRepos
      restartPanelPoll()
      multiRepoDriver.update(nextPath)
    }
    // Divergence poller — restart when session identity or sessions array changes
    // (worktrees live inside sessions, so any worktree change comes with a new
    // sessions reference via the reducer's immutable updates).
    if (
      state.currentSessionId !== lastDivergenceSessionId ||
      state.sessions !== lastDivergenceSessions
    ) {
      lastDivergenceSessionId = state.currentSessionId
      lastDivergenceSessions = state.sessions
      restartDivergencePoll()
    }
    // Diff radius prefetch — recompute the window whenever any tracked input
    // shifts. `update()` is cheap when nothing meaningful changed because the
    // queue dedupes by key and skips already-cached / inflight entries.
    if (
      nextPath !== lastPrefetchProjectPath ||
      state.gitMode !== lastPrefetchGitMode ||
      state.gitPanel !== lastPrefetchGitPanel ||
      state.gitPane !== lastPrefetchGitPane
    ) {
      lastPrefetchProjectPath = nextPath
      lastPrefetchGitMode = state.gitMode
      lastPrefetchGitPanel = state.gitPanel
      lastPrefetchGitPane = state.gitPane
      diffPrefetchDriver.update()
    }
    // Resize cascade — fires when any layout-driven input changes. Reference
    // equality on layoutTrees/tabs is enough (reducers replace these on every
    // structural mutation); for primitives we compare values. Without this
    // guard the cascade would fire on every tab-activity / git-poll tick and
    // flood the daemon with no-op resize commands.
    const nextCols = state.layout.terminalCols
    const nextRows = state.layout.terminalRows
    const colsChanged = nextCols !== lastLayoutCols
    const rowsChanged = nextRows !== lastLayoutRows
    const sidebarChanged =
      state.sidebar.visible !== lastSidebarVisible || state.sidebar.width !== lastSidebarWidth
    const gitPaneChanged =
      state.gitPane.mode !== lastGitPaneMode ||
      state.gitPane.visible !== lastGitPaneVisible ||
      state.gitPane.position !== lastGitPanePosition ||
      state.gitPane.paneRatio !== lastGitPaneRatio
    const treesChanged = state.layoutTrees !== lastLayoutTrees
    const tabsChanged = state.tabs !== lastTabsRef
    if (colsChanged || rowsChanged) {
      // First real size from the frontend (via the resizeTab → set-terminal-size
      // bridge above) unlocks the cascade. Before this, terminalCols/Rows are
      // still the 80×24 store defaults and pushing them would corrupt PTYs.
      terminalSizeKnown = true
    }
    if (
      terminalSizeKnown &&
      (colsChanged ||
        rowsChanged ||
        sidebarChanged ||
        gitPaneChanged ||
        treesChanged ||
        tabsChanged)
    ) {
      lastLayoutCols = nextCols
      lastLayoutRows = nextRows
      lastSidebarVisible = state.sidebar.visible
      lastSidebarWidth = state.sidebar.width
      lastGitPaneMode = state.gitPane.mode
      lastGitPaneVisible = state.gitPane.visible
      lastGitPanePosition = state.gitPane.position
      lastGitPaneRatio = state.gitPane.paneRatio
      lastLayoutTrees = state.layoutTrees
      lastTabsRef = state.tabs
      const trees = Object.values(state.layoutTrees)
      const hasSplits = trees.some((t) => t.type === 'split')
      const tabIds = state.tabs.map((t) => t.id)
      // queueMicrotask: break reentrance if backend resize ever writes to the store
      queueMicrotask(() => {
        if (hasSplits) {
          resizeSplitTabs(backend, state.layoutTrees, tabIds, nextCols, nextRows)
        } else {
          backend.resizeAll(nextCols, nextRows)
        }
      })
    }
    directorySearch.onModal(state.modal)
    scheduleBroadcast()
  })

  // Initial attach (load-session above fired before subscribe was wired).
  if (lastSessionId !== null && lastSessionId !== '') {
    attachSession(lastSessionId)
  }

  // Mirror the TUI's npm-version probe (src/app.tsx) so the GUI's already-
  // rendered UpdateAvailableModal pops when a newer version exists. Guards
  // match the TUI: env opt-out, dev profile, and the per-version skip the
  // user toggles from the modal itself.
  if (process.env.AIMUX_DISABLE_UPDATE_CHECK !== '1' && getProfileName() !== 'dev') {
    void (async () => {
      try {
        const [current, latest] = await Promise.all([
          getCurrentPackageVersion(),
          fetchLatestNpmVersion('@brimveyn/aimux'),
        ])
        if (updateCheckCancelled || !(latest != null && latest !== '')) return
        if (!isNewerVersion(latest, current)) return
        if (loadConfig().skippedUpdateVersion === latest) return
        logDebug('gui.host.updateAvailable', { current, latest })
        dispatch({
          currentVersion: current,
          latestVersion: latest,
          type: 'open-update-available-modal',
        })
      } catch (error) {
        // Best-effort: a registry hiccup or DNS failure must not crash the
        // host. React swallows the rejection in the TUI; the host has no
        // such safety net.
        logDebug('gui.host.updateCheckFailed', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })()
  }

  // Fail loudly if a stale GUI host still holds the port, instead of silently
  // leaving the browser talking to an old (version-skewed) host.
  const portOccupied = await new Promise<boolean>((resolve) => {
    const probe = connect(GUI_PORT, '127.0.0.1')
    probe.once('connect', () => {
      probe.destroy()
      resolve(true)
    })
    probe.once('error', () => resolve(false))
  })
  if (portOccupied) {
    process.stdout.write(
      `\n✖ aimux GUI: port ${GUI_PORT} is already in use (a previous host is still running).\n` +
        `  Kill it and retry:\n    lsof -ti tcp:${GUI_PORT} | xargs kill -9\n\n`
    )
    process.exit(1)
  }

  const server = Bun.serve({
    fetch(req, srv) {
      if (new URL(req.url).pathname === '/ws') {
        if (srv.upgrade(req)) {
          return
        }
        return new Response('upgrade failed', { status: 426 })
      }
      return new Response('aimux gui host', { status: 200 })
    },
    hostname: '127.0.0.1',
    port: GUI_PORT,
    websocket: {
      close(ws) {
        if (activeWs === ws) {
          activeWs = null
          activeWsState = null
          // TODO(P0.8): pause backend broadcast when no client is connected.
          // `setBroadcastEnabled` lives on pty-manager.ts but is not exposed
          // through the SessionBackend interface; wiring it requires either
          // an interface extension or a remote-backend IPC verb. Leaving
          // commented to make the gap visible.
          // backend.setBroadcastEnabled?.(false)
        }
      },
      message(ws, raw) {
        const message = parseClientMessage(typeof raw === 'string' ? raw : raw.toString())
        if (message === null) {
          return
        }
        const state = getState()
        switch (message.t) {
          case 'key':
            pipeline.handleKey({
              ctrl: message.ctrl,
              meta: message.meta,
              name: message.name,
              sequence: message.sequence,
              shift: message.shift,
            })
            break
          case 'paste':
            if (state.focusMode === 'command-edit') {
              const sanitized = message.text.replaceAll(/\r\n?/g, '\n')
              dispatch({ char: sanitized, type: 'update-command-edit' })
              break
            }
            if (state.focusMode === 'terminal-input' && state.activeTabId !== null) {
              const tab = state.tabs.find((entry) => entry.id === state.activeTabId)
              const wrapped =
                tab?.terminalModes.bracketedPasteMode === true
                  ? `\x1b[200~${message.text}\x1b[201~`
                  : message.text
              backend.write(state.activeTabId, wrapped)
            }
            break
          case 'scroll':
            if (state.activeTabId !== null) {
              backend.scrollViewport(state.activeTabId, message.deltaLines)
            }
            break
          case 'resizeWindow':
            dispatch({ cols: message.cols, rows: message.rows, type: 'set-terminal-size' })
            break
          case 'resizeTab': {
            backend.resizeTab(message.tabId, message.cols, message.rows)
            // The frontend measures each xterm pane pixel-perfectly and pushes
            // resizeTab per visible pane. For a single-leaf active tab, that
            // measurement IS the current main-area size — recording it in
            // `layout` lets the subscribe-driven cascade below propagate it to
            // hidden tabs (which the frontend can't measure). Skip split tabs:
            // their resizeTab carries a sub-pane size, not the full area.
            const groupId = state.tabGroupMap[message.tabId]
            const tree = groupId != null && groupId !== '' ? state.layoutTrees[groupId] : undefined
            const isSingleLeaf = tree !== undefined && tree.type === 'leaf'
            if (
              message.tabId === state.activeTabId &&
              isSingleLeaf &&
              (state.layout.terminalCols !== message.cols ||
                state.layout.terminalRows !== message.rows)
            ) {
              dispatch({ cols: message.cols, rows: message.rows, type: 'set-terminal-size' })
            }
            break
          }
          case 'paneActivate':
            dispatch({ tabId: message.tabId, type: 'set-active-tab' })
            break
          case 'requestBytes': {
            // The frontend xterm.js pulls its scrollback on mount (one request
            // per fresh instance). Serialize the current buffer and send it.
            // The remote backend's serialize is async (IPC round-trip); fire
            // and forget — the client already RIS-resets before applying.
            if (!state.tabs.some((t) => t.id === message.tabId)) {
              logDebug('gui.host.requestBytes.unknownTab', { tabId: message.tabId })
              break
            }
            if (activeWsState !== null && !tryConsumeRequestBytesToken(activeWsState)) {
              logDebug('gui.host.requestBytes.rateLimited', { tabId: message.tabId })
              break
            }
            void sendBytesDump(message.tabId)
            break
          }
          case 'modalSelect':
            pipeline.selectModalIndex(message.index)
            break
          case 'modalConfirm':
            if (message.index !== undefined) {
              pipeline.selectModalIndex(message.index)
            }
            pipeline.confirmActiveModal()
            break
          case 'setSplitRatio':
            dispatch({
              axis: message.axis,
              ratio: message.ratio,
              tabId: message.tabId,
              type: 'set-split-ratio',
            })
            break
          case 'openNewTab':
            // Same action Ctrl+N resolves to, dispatched directly (mode-independent).
            dispatch({ type: 'open-new-tab-modal' })
            break
          case 'openAiUsageModal':
            // Clicking the usage indicator opens the detail modal (web-native:
            // explicit host command, not a simulated keystroke).
            dispatch({ type: 'open-ai-usage-modal' })
            break
          case 'closeTab':
            dispatch({ tabId: message.tabId, type: 'close-tab' })
            backend.disposeSession(message.tabId)
            snippetDriver.dispose(message.tabId)
            break
          case 'switchSession': {
            const session = state.sessions.find((entry) => entry.id === message.sessionId)
            if (session) {
              handleSwitchSessionEffect(state, backend, dispatch, session)
            }
            break
          }
          case 'createSession':
            handleCreateSessionEffect(
              state,
              dispatch,
              basename(message.path) || message.path,
              message.path
            )
            break
          case 'deleteSession':
            handleDeleteSessionEffect(state, backend, dispatch, message.sessionId)
            break
          case 'openWorktreeMove':
            dispatch({
              sourceWorktreeId: message.sourceWorktreeId,
              type: 'open-worktree-move-modal',
            })
            break
          case 'toggleWorktreeMoveDelete':
            dispatch({ type: 'toggle-worktree-move-delete' })
            break
          case 'openSnippetEditor':
            dispatch({ snippetId: message.snippetId, type: 'open-snippet-editor' })
            break
          default:
            break
        }
      },
      open(ws) {
        // Single-client host: a Tauri reload / HMR / second window arrives as
        // a new socket without the old one closing first. Close the previous
        // peer explicitly so we don't leak silently-dead clients.
        if (activeWs !== null && activeWs !== ws) {
          logDebug('gui.host.displacingPreviousClient', {})
          activeWs.close(1000, 'displaced by new client')
        }
        activeWs = ws
        activeWsState = {
          requestBytesLastRefillMs: performance.now(),
          requestBytesTokens: REQUEST_BYTES_CAPACITY,
          ws,
        }
        // TODO(P0.8): resume backend broadcast on first client connect; see
        // matching note in close(). Symmetric with the pause TODO above.
        // backend.setBroadcastEnabled?.(true)
        // Handshake first: the renderer refuses to interpret any subsequent
        // frame until it has seen `hello` and verified the protocol version.
        send({ capabilities: [], t: 'hello', version: PROTOCOL_VERSION })
        // Push the initial state projection. Each xterm.js pane pulls its own
        // scrollback via requestBytes once it mounts, so there's nothing to
        // replay here.
        broadcastState()
      },
    },
  })

  const port = server.port ?? GUI_PORT
  const url = `http://127.0.0.1:${port}`
  process.stdout.write(`aimux gui host listening on ${url} (ws ${url}/ws)\n`)
  logDebug('gui.host.listening', { port })

  const shell = await launchShell(port)
  if (shell !== null) {
    await shell.exited
    disposers.panel?.()
    disposers.divergence?.()
    disposers.diff?.()
    disposers.diffPrefetch?.()
    disposers.multiRepo?.()
    disposers.claudeThemeSync?.()
    disposers.autosave?.()
    disposeBackend()
    await backend.destroy()
    void server.stop()
    process.exit(0)
  }

  process.stdout.write(
    'Running GUI host without a window. Open the frontend yourself:\n' +
      '  Browser (HMR):  cd desktop && bun run dev   -> http://localhost:1420\n' +
      '  Native window:  cd desktop && bun run tauri build, then `bun run gui`\n'
  )
  await new Promise<never>(() => {})
}
