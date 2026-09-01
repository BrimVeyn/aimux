import { getStatusBarSeparator, type ResolvedConfig } from '@brimveyn/aimux-config'
import { basename } from 'node:path'

import type { SessionBackend } from '../session-backend/types'
import type { AppAction } from '../state/actions'
import type { LayoutState } from '../state/types'

import { version as APP_VERSION } from '../../package.json'
import { attachCurrentSession } from '../app-runtime/backend-attach-runtime'
import { bindBackendRuntimeEvents } from '../app-runtime/backend-runtime-events'
import { createProjectFromCurrentState } from '../app-runtime/project-actions'
import { startProjectAutosave } from '../app-runtime/use-project-autosave'
import { resizeSplitTabs } from '../app-runtime/use-terminal-resize'
import { loadConfig } from '../config'
import { logDebug } from '../debug/input-log'
import { startDiffOnDemandPipeline } from '../git/diff-orchestration'
import { startGitPanelPolling } from '../git/git-poller'
import { startPrStatusPolling } from '../git/pr-status-poller'
import { startWorkspaceDivergencePolling } from '../git/workspace-divergence-poller'
import { setActiveKeymap } from '../input/keymap/keymap-ref'
import { registerAllModes } from '../input/modes/handlers'
import { ensureClaudeSettingsThemePref, syncClaudeTheme } from '../integrations/claude-theme-sync'
import { startAIUsageService } from '../services/ai-usage/provider'
import { HINTS_ENABLED } from '../settings/sections/status-bar'
import { settingsStore } from '../settings/settings-store'
import { aiUsageStore } from '../state/ai-usage-store'
import { appStore } from '../state/app-store'
import { getBarWidth } from '../state/bars'
import { setActiveDispatch, setActiveSideEffectRunner } from '../state/dispatch-ref'
import { gitFileKey } from '../state/git-tree'
import {
  findMostRecentProject,
  loadProjectCatalog,
  saveProjectCatalog,
} from '../state/project-catalog'
import { loadSnippetCatalog, mergeConfigSnippets } from '../state/snippet-catalog'
import { createInitialState } from '../state/store'
import { getActiveWorkspacePath } from '../state/workspace-view'
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
import { startDiffPrefetchDriver } from './diff-prefetch-driver'
import { createDirectorySearchRunner } from './gui-directory-search'
import { computeGuiHelpEntries } from './gui-help-entries'
import { createPipeline } from './host-pipeline'
import { createStubRenderer, createTabTimeouts } from './host-side-effect-ctx'
import { startMultiRepoDiscoveryDriver } from './multi-repo-discovery-driver'
import { createSnippetTriggerDriver } from './snippet-trigger-driver'
import { type AppStateProjection, projectAppState } from './state-projection'

export type HostPipeline = ReturnType<typeof createPipeline>

export interface GuiRuntimeEvents {
  onBytes(listener: (msg: { data: string; tabId: string }) => void): () => void
  onProjection(listener: (projection: AppStateProjection) => void): () => void
}

export interface GuiRuntime {
  /** Returns the current projection (used by transport to send initial state). */
  buildProjection: () => AppStateProjection
  dispatch: (action: AppAction) => void
  /** Disposes drivers, subscribers, pollers. Idempotent. */
  dispose: () => Promise<void>
  events: GuiRuntimeEvents
  getState: () => ReturnType<typeof appStore.getState>
  /** Validate `tabId` exists in the current state (used by requestBytes). */
  hasTab: (tabId: string) => boolean
  pipeline: HostPipeline
  /**
   * Pull a tab's serialized scrollback for the `bytesReset` dump.
   * Returns `null` if the tab is unknown or has nothing to send.
   */
  serializeBuffer: (tabId: string) => Promise<string | null>
}

export interface CreateGuiRuntimeDeps {
  backend: SessionBackend
  resolvedConfig: ResolvedConfig
}

// Centralised cleanup registry: every long-lived subscription, poller, or
// driver registers its disposer here. `dispose()` runs them once, in
// registration order, swallowing individual failures.
class Disposers {
  private list: (() => void)[] = []
  private done = false
  add(fn: (() => void) | null | undefined): void {
    if (typeof fn === 'function') {
      this.list.push(fn)
    }
  }
  async run(): Promise<void> {
    if (this.done) return
    this.done = true
    for (const fn of this.list) {
      try {
        fn()
      } catch (error) {
        logDebug('gui.runtime.disposerFailed', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    this.list = []
  }
}

export async function createGuiRuntime(deps: CreateGuiRuntimeDeps): Promise<GuiRuntime> {
  const { backend, resolvedConfig } = deps
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

  const disposers = new Disposers()

  // Claude Code theme harmonisation (beta) — port of src/app.tsx:186-193.
  // Writes ~/.claude/themes/aimux.json once at boot and on every theme change
  // so Claude Code's watcher picks up the live aimux theme. No-op when the
  // beta flag is off.
  if (resolvedConfig.theme?.beta?.harmonizeClaudeTheme === true) {
    ensureClaudeSettingsThemePref()
    syncClaudeTheme(getCurrentTheme(), getCurrentMode())
    disposers.add(
      subscribeThemeChanges((resolved, mode) => {
        syncClaudeTheme(resolved, mode)
      })
    )
  }

  // Initial AppState (port of app.tsx's lazy init, trimmed for the GUI).
  let projectCatalog = loadProjectCatalog()
  const mergedSnippets = mergeConfigSnippets(loadSnippetCatalog(), resolvedConfig.snippets)
  const initial = createInitialState(json.customCommands, projectCatalog, mergedSnippets, false, {
    // The sidebar became `bars`, and the tab strip has no position of its own
    // any more — it sits above the panes, full stop.
    bars: json.bars,
    projectBarVisible: resolvedConfig.projectBar?.initialVisible ?? json.projectBarVisible ?? true,
  })
  appStore.setState(initial)

  const dispatch = appStore.getState().dispatch
  const getState = () => appStore.getState()

  // Resolve the initial project: most recent, else a fresh one for the cwd.
  let initialProject = findMostRecentProject(projectCatalog)
  if (initialProject === undefined) {
    const cwd = process.cwd()
    const created = createProjectFromCurrentState(getState(), basename(cwd) || cwd, cwd)
    projectCatalog = created.projects
    saveProjectCatalog(projectCatalog)
    dispatch({ projects: projectCatalog, type: 'set-projects' })
    initialProject = created.project
  }
  dispatch({
    projectId: initialProject.id,
    projectSnapshot: initialProject.projectSnapshot,
    type: 'load-project',
  })

  setActiveKeymap(resolvedConfig.keymaps)
  const handlers = registerAllModes(resolvedConfig.keymaps)
  const helpEntries = computeGuiHelpEntries(resolvedConfig.keymaps)
  setActiveDispatch(dispatch)
  const directorySearch = createDirectorySearchRunner(dispatch)

  const timeouts = createTabTimeouts()
  const renderer = createStubRenderer()

  // ───── Event fan-out ──────────────────────────────────────────────────
  // Listeners installed by the transport. We keep them in Sets and iterate
  // synchronously on emit; reentrant subscribe/unsubscribe within a notify
  // pass would be a bug — none of the call sites do that today.
  interface BytesEvent {
    data: string
    tabId: string
  }
  const projectionListeners = new Set<(projection: AppStateProjection) => void>()
  const bytesListeners = new Set<(msg: BytesEvent) => void>()
  const events: GuiRuntimeEvents = {
    onBytes(listener) {
      bytesListeners.add(listener)
      return () => bytesListeners.delete(listener)
    },
    onProjection(listener) {
      projectionListeners.add(listener)
      return () => projectionListeners.delete(listener)
    },
  }

  const buildProjection = (): AppStateProjection => {
    const state = getState()
    const usage = aiUsageStore.getState()
    return projectAppState(state, {
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
        ...getStatusBarModel(state, resolvedConfig.keymaps),
        hints: settingsStore.getState().values[HINTS_ENABLED] !== false,
        separator: getStatusBarSeparator(),
        version: APP_VERSION,
      },
      themeId: getCurrentThemeId(),
      themeMode: getCurrentMode(),
      transparent: getTransparent(),
    })
  }

  let broadcastScheduled = false
  const scheduleBroadcast = (): void => {
    if (broadcastScheduled) {
      return
    }
    broadcastScheduled = true
    queueMicrotask(() => {
      broadcastScheduled = false
      const projection = buildProjection()
      for (const listener of projectionListeners) {
        listener(projection)
      }
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
    disposers.add(() => {
      handle.stop()
      aiUsageStore.getState().clear()
      aiUsageStore.getState().setEnabled(false)
    })
  }

  // Theme preview/confirm/restore all go through applyTheme on the singleton;
  // rebroadcast so the browser recolors live as the user moves in the picker.
  disposers.add(subscribeThemeChanges(() => scheduleBroadcast()))

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

  // Serialize a tab's current scrollback as an ANSI dump. Pull-based: the
  // frontend xterm.js requests this on mount (one request per fresh terminal
  // instance) so the host never has to guess when a dump is needed. This
  // avoids the double-paint bug where pushing a dump into an xterm that
  // already holds the scrollback stacks duplicate splash screens.
  const serializeBuffer = async (tabId: string): Promise<string | null> => {
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
    return data === '' ? null : data
  }

  const handleBackendBytes = (tabId: string, data: string): void => {
    // Live PTY output for every tab — the GUI keeps a persistent xterm instance
    // per tab (alive across switches), so hidden tabs must stay current without
    // a re-dump. The initial scrollback still comes via the frontend's
    // requestBytes (one dump per instance creation).
    for (const listener of bytesListeners) {
      listener({ data, tabId })
    }
  }
  backend.on('bytes', handleBackendBytes)
  // Tab can die without a closeTab message (PTY crash, daemon eviction).
  // Drop the per-tab detector + in-flight guard so a recycled tabId doesn't
  // inherit stale state. The existing bindBackendRuntimeEvents call also
  // registers an 'exit' listener — multiple EventEmitter listeners are fine.
  const handleBackendExit = (tabId: string): void => {
    snippetDriver.dispose(tabId)
  }
  backend.on('exit', handleBackendExit)
  disposers.add(() => {
    backend.off('bytes', handleBackendBytes)
    backend.off('exit', handleBackendExit)
  })

  // React to session/active-tab changes (attach + setActiveTab), like the TUI runtime.
  const layoutRef: { current: LayoutState } = { current: getState().layout }
  const attachRequestIdRef = { current: 0 }
  let lastSessionId = getState().currentProjectId
  let lastActiveTabId = getState().activeTabId
  const attachSession = (projectId: string): void => {
    const project = getState().projects.find((entry) => entry.id === projectId)
    attachCurrentSession({
      attachRequestIdRef,
      backend,
      currentProjectId: projectId,
      currentProjectProjectSnapshot: project?.projectSnapshot,
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
    const id = state.currentProjectId
    const session = id != null && id !== '' ? state.projects.find((s) => s.id === id) : undefined
    return getActiveWorkspacePath(session)
  }
  let lastPanelProjectPath = projectPathOf(getState())
  let lastPanelHeadOffset = getState().gitMode.headOffset
  let lastPanelRepos = getState().multiRepo.repos
  let panelDispose: (() => void) | null = null
  let prDispose: (() => void) | null = null
  // The PR state row and the github tab poll the same path the file list does.
  const restartPrPoll = (): void => {
    prDispose?.()
    prDispose = startPrStatusPolling({ enabled: true, projectPath: lastPanelProjectPath })
  }
  const restartPanelPoll = (): void => {
    panelDispose?.()
    panelDispose = startGitPanelPolling({
      enabled: true,
      getRepos: () => appStore.getState().multiRepo.repos,
      headOffset: lastPanelHeadOffset,
      projectPath: lastPanelProjectPath,
    })
  }
  let lastDivergenceSessionId = getState().currentProjectId
  let lastDivergenceSessions = getState().projects
  // Prefetch driver tracks — the queue dedupes by key so we just need to
  // call `update()` whenever any input might have changed. These four
  // references cover all the hook's deps: `gitMode` carries selectedEntryKey
  // / diffs / parsed / loading / collapsedFolders / headOffset, `gitPanel`
  // carries files, `gitPane` carries radius / fileListMode / treeCompaction.
  let lastPrefetchProjectPath = projectPathOf(getState())
  let lastPrefetchGitMode = getState().gitMode
  let lastPrefetchGitPanel = getState().gitPanel
  let lastPrefetchGitPane = getState().gitPane
  let divergenceDispose: (() => void) | null = null
  const restartDivergencePoll = (): void => {
    divergenceDispose?.()
    divergenceDispose = startWorkspaceDivergencePolling(true)
  }
  const multiRepoDriver = startMultiRepoDiscoveryDriver({ dispatch })
  multiRepoDriver.update(lastPanelProjectPath)
  disposers.add(() => multiRepoDriver.dispose())
  restartPanelPoll()
  restartPrPoll()
  restartDivergencePoll()
  disposers.add(() => panelDispose?.())
  disposers.add(() => prDispose?.())
  disposers.add(() => divergenceDispose?.())

  // Workspace autosave — TUI uses useWorkspaceAutosave (debounce 250ms) to
  // persist tabs/layout/gitPane on every state change. Same React-hook blocker
  // as the pollers: drive it from the host so the GUI restores the last
  // workspace snapshot on next launch.
  disposers.add(
    startProjectAutosave({
      debounceMs: 250,
      getState: () => appStore.getState(),
      subscribe: (listener) => appStore.subscribe(listener),
    })
  )

  // On-demand diff fetcher — pulls the diff for the currently selected entry
  // in git-mode. Subscribes to the store internally; same rationale as the
  // pollers above (no React root in GUI mode → React hook never runs).
  disposers.add(
    startDiffOnDemandPipeline({
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
  )

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
  disposers.add(() => diffPrefetchDriver.dispose())
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
  // Chrome that steals columns from the panes is now the two bars — the git
  // pane became a bar widget, and git mode replaces the pane tree outright, so
  // neither changes the terminal's usable size any more.
  let lastLeftBarWidth = getBarWidth(getState().bars.left)
  let lastRightBarWidth = getBarWidth(getState().bars.right)
  let lastLayoutTrees = getState().layoutTrees
  let lastTabsRef = getState().tabs
  let terminalSizeKnown = false

  const unsubscribeStore = appStore.subscribe(() => {
    const state = getState()
    layoutRef.current = state.layout
    if (state.currentProjectId !== lastSessionId) {
      lastSessionId = state.currentProjectId
      if (state.currentProjectId !== null && state.currentProjectId !== '') {
        attachSession(state.currentProjectId)
      }
    }
    if (state.activeTabId !== lastActiveTabId) {
      lastActiveTabId = state.activeTabId
      if (state.currentProjectId !== null && state.currentProjectId !== '') {
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
      restartPrPoll()
      multiRepoDriver.update(nextPath)
    }
    // Divergence poller — restart when session identity or sessions array changes
    // (worktrees live inside sessions, so any worktree change comes with a new
    // sessions reference via the reducer's immutable updates).
    if (
      state.currentProjectId !== lastDivergenceSessionId ||
      state.projects !== lastDivergenceSessions
    ) {
      lastDivergenceSessionId = state.currentProjectId
      lastDivergenceSessions = state.projects
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
    const nextLeftBarWidth = getBarWidth(state.bars.left)
    const nextRightBarWidth = getBarWidth(state.bars.right)
    const barsChanged =
      nextLeftBarWidth !== lastLeftBarWidth || nextRightBarWidth !== lastRightBarWidth
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
      (colsChanged || rowsChanged || barsChanged || treesChanged || tabsChanged)
    ) {
      lastLayoutCols = nextCols
      lastLayoutRows = nextRows
      lastLeftBarWidth = nextLeftBarWidth
      lastRightBarWidth = nextRightBarWidth
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
  disposers.add(unsubscribeStore)

  // Initial attach (load-session above fired before subscribe was wired).
  if (lastSessionId !== null && lastSessionId !== '') {
    attachSession(lastSessionId)
  }

  const hasTab = (tabId: string): boolean => getState().tabs.some((t) => t.id === tabId)

  return {
    buildProjection,
    dispatch,
    dispose: async () => disposers.run(),
    events,
    getState,
    hasTab,
    pipeline,
    serializeBuffer,
  }
}
