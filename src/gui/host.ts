import type { ServerWebSocket } from 'bun'

import {
  setAutoCommitEnabled,
  setExternalEditorConfig,
  setMultiRepoConfig,
} from '@brimveyn/aimux-config'
import { connect } from 'node:net'
import { basename } from 'node:path'

import type { LayoutState } from '../state/types'

import { attachCurrentSession } from '../app-runtime/backend-attach-runtime'
import { bindBackendRuntimeEvents } from '../app-runtime/backend-runtime-events'
import {
  createSessionFromCurrentState,
  handleCreateSessionEffect,
  handleDeleteSessionEffect,
  handleSwitchSessionEffect,
} from '../app-runtime/session-actions'
import { loadConfig } from '../config'
import { loadUserConfig } from '../config/loader'
import { logDebug } from '../debug/input-log'
import { setActiveKeymap } from '../input/keymap/keymap-ref'
import { registerAllModes } from '../input/modes/handlers'
import { createSessionBackend } from '../session-backend/bootstrap'
import { appStore } from '../state/app-store'
import { setActiveDispatch, setActiveSideEffectRunner } from '../state/dispatch-ref'
import {
  findMostRecentSession,
  loadSessionCatalog,
  saveSessionCatalog,
} from '../state/session-catalog'
import { loadSnippetCatalog, mergeConfigSnippets } from '../state/snippet-catalog'
import { createInitialState } from '../state/store'
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
import { computeVisibleTabIds } from './host-visible'
import { launchShell } from './launch-shell'
import { type GuiServerMessage, parseClientMessage } from './protocol'
import { projectAppState } from './state-projection'

const GUI_PORT = 7878

export async function runGui(): Promise<void> {
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

  const backend = await createSessionBackend()
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
    send({
      projection: projectAppState(getState(), {
        // `committedThemeId` is the saved id — used for the "(current)" marker so
        // it stays put while previewing. `themeId` is the LIVE theme (preview +
        // confirm/restore) and drives the renderer CSS.
        committedThemeId: themeId,
        helpEntries,
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

  // Forward renders for every VISIBLE pane (all leaves of the active group's tree).
  const lastRender = new Map<string, GuiServerMessage & { t: 'render' }>()
  const visibleTabIds = (): string[] =>
    computeVisibleTabIds(getState().layoutTrees, getState().tabGroupMap, getState().activeTabId)
  backend.on('render', (tabId, viewport, modes) => {
    const message: GuiServerMessage & { t: 'render' } = { modes, t: 'render', tabId, viewport }
    lastRender.set(tabId, message)
    if (visibleTabIds().includes(tabId)) {
      send(message)
    }
  })
  const replayVisible = (): void => {
    for (const tabId of visibleTabIds()) {
      const cached = lastRender.get(tabId)
      if (cached) {
        send(cached)
      }
    }
  }

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
    directorySearch.onModal(state.modal)
    scheduleBroadcast()
    replayVisible()
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
          default:
            break
        }
      },
      open(ws) {
        activeWs = ws
        broadcastState()
        replayVisible()
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
