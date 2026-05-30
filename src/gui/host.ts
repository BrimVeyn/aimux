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
import { startWorkspaceAutosave } from '../app-runtime/use-workspace-autosave'
import { loadConfig } from '../config'
import { loadUserConfig } from '../config/loader'
import { logDebug } from '../debug/input-log'
import { startDiffOnDemandPipeline } from '../git/diff-orchestration'
import { startGitPanelPolling } from '../git/git-poller'
import { startWorktreeDivergencePolling } from '../git/worktree-divergence-poller'
import { setActiveKeymap } from '../input/keymap/keymap-ref'
import { registerAllModes } from '../input/modes/handlers'
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
  getCurrentThemeId,
  getTransparent,
  setMode,
  setTransparent,
  subscribeThemeChanges,
} from '../ui/theme'
import { isKnownThemeId, type ThemeId } from '../ui/themes'
import { createDirectorySearchRunner } from './gui-directory-search'
import { computeGuiHelpEntries } from './gui-help-entries'
import { createPipeline } from './host-pipeline'
import { createStubRenderer, createTabTimeouts } from './host-side-effect-ctx'
import { launchShell } from './launch-shell'
import { type GuiServerMessage, parseClientMessage } from './protocol'
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
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => {
      flushAutosave()
      disposeBackend()
      process.exit(0)
    })
  }

  setActiveKeymap(resolvedConfig.keymaps)
  const handlers = registerAllModes(resolvedConfig.keymaps)
  const helpEntries = computeGuiHelpEntries(resolvedConfig.keymaps)
  setActiveDispatch(dispatch)
  const directorySearch = createDirectorySearchRunner(dispatch)

  const timeouts = createTabTimeouts()
  const renderer = createStubRenderer()

  let activeWs: ServerWebSocket<unknown> | null = null
  const send = (message: GuiServerMessage): void => {
    activeWs?.send(JSON.stringify(message))
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

  const pipeline = createPipeline({
    backend,
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
  const disposers: {
    autosave: (() => void) | null
    diff: (() => void) | null
    divergence: (() => void) | null
    panel: (() => void) | null
  } = {
    autosave: null,
    diff: null,
    divergence: null,
    panel: null,
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
  const restartDivergencePoll = (): void => {
    disposers.divergence?.()
    disposers.divergence = startWorktreeDivergencePolling({
      enabled: true,
      getCurrentSessionId: () => appStore.getState().currentSessionId,
      getSessions: () => appStore.getState().sessions,
    })
  }
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
    directorySearch.onModal(state.modal)
    scheduleBroadcast()
  })

  // Initial attach (load-session above fired before subscribe was wired).
  if (lastSessionId !== null && lastSessionId !== '') {
    attachSession(lastSessionId)
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
          case 'resizeTab':
            backend.resizeTab(message.tabId, message.cols, message.rows)
            break
          case 'paneActivate':
            dispatch({ tabId: message.tabId, type: 'set-active-tab' })
            break
          case 'requestBytes':
            // The frontend xterm.js pulls its scrollback on mount (one request
            // per fresh instance). Serialize the current buffer and send it.
            // The remote backend's serialize is async (IPC round-trip); fire
            // and forget — the client already RIS-resets before applying.
            void sendBytesDump(message.tabId)
            break
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
        activeWs = ws
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
