import type { ServerWebSocket } from 'bun'

import { basename } from 'node:path'

import type {
  AssistantId,
  SessionRecord,
  TerminalModeState,
  TerminalSnapshot,
} from '../state/types'

import { createSessionFromCurrentState, deleteSessionRecords } from '../app-runtime/session-actions'
import { logDebug } from '../debug/input-log'
import { ASSISTANT_OPTIONS } from '../pty/command-registry'
import { createSessionBackend } from '../session-backend/bootstrap'
import {
  findMostRecentSession,
  loadSessionCatalog,
  saveSessionCatalog,
} from '../state/session-catalog'
import { getSessionProjectPath } from '../state/session-worktrees'
import { createInitialState } from '../state/store'
import { launchShell } from './launch-shell'
import {
  type GuiServerMessage,
  parseClientMessage,
  type SessionMeta,
  type TabMeta,
} from './protocol'

const GUI_PORT = 7878
const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

interface CachedRender {
  viewport: TerminalSnapshot
  modes: TerminalModeState
}

export async function runGui(): Promise<void> {
  const backend = await createSessionBackend()

  let sessions: SessionRecord[] = []
  let currentSession: SessionRecord | null = null
  let currentSessionId: string | null = null
  let tabs: TabMeta[] = []
  let activeTabId: string | null = null
  let cols = DEFAULT_COLS
  let rows = DEFAULT_ROWS
  let activeWs: ServerWebSocket<unknown> | null = null
  const lastRender = new Map<string, CachedRender>()
  const sessionStatuses = new Map<string, SessionMeta['status']>()

  const send = (message: GuiServerMessage): void => {
    activeWs?.send(JSON.stringify(message))
  }

  const sessionMetas = (): SessionMeta[] =>
    sessions.map((session) => ({
      id: session.id,
      name: session.name,
      path: getSessionProjectPath(session),
      status: sessionStatuses.get(session.id),
    }))

  const sendInit = (): void => {
    send({
      activeTabId,
      cols,
      currentSessionId,
      rows,
      sessions: sessionMetas(),
      t: 'init',
      tabs,
    })
  }

  const broadcastTabs = (): void => {
    send({ activeTabId, t: 'tabs', tabs })
  }

  const broadcastSessions = (): void => {
    send({ currentSessionId, sessions: sessionMetas(), t: 'sessions' })
  }

  const replayActive = (): void => {
    if (activeTabId === null) {
      return
    }
    const cached = lastRender.get(activeTabId)
    if (cached) {
      send({ modes: cached.modes, t: 'render', tabId: activeTabId, viewport: cached.viewport })
    }
  }

  const createTab = (assistant: AssistantId): void => {
    const option =
      ASSISTANT_OPTIONS.find((entry) => entry.id === assistant) ??
      ASSISTANT_OPTIONS.find((entry) => entry.id === 'terminal')
    if (!option) {
      return
    }

    const tabId = crypto.randomUUID()
    backend.createSession({
      assistant: option.id,
      cols,
      command: option.command,
      cwd: getSessionProjectPath(currentSession ?? undefined) ?? process.cwd(),
      rows,
      tabId,
      title: option.label,
    })
    tabs = [
      ...tabs,
      { assistant: option.id, command: option.command, id: tabId, title: option.label },
    ]
    activeTabId = tabId
    backend.setActiveTab(tabId)
    broadcastTabs()
  }

  // Attach the backend to a session, hydrate its tabs, and (re)broadcast state.
  const attachSession = async (session: SessionRecord): Promise<void> => {
    const result = await backend.attach({
      cols,
      rows,
      sessionId: session.id,
      workspaceSnapshot: session.workspaceSnapshot,
    })
    currentSession = session
    currentSessionId = session.id
    lastRender.clear()

    if (result !== null) {
      tabs = result.tabs.map((tab) => ({
        activity: tab.activity,
        assistant: tab.assistant,
        command: tab.command,
        id: tab.id,
        title: tab.title,
      }))
      activeTabId = result.activeTabId
      for (const entry of result.initialSessionStatuses) {
        sessionStatuses.set(entry.sessionId, entry.status)
      }
    } else {
      tabs = []
      activeTabId = null
    }

    if (tabs.length === 0) {
      createTab('terminal')
    } else if (activeTabId !== null) {
      backend.setActiveTab(activeTabId)
    }

    sendInit()
    broadcastSessions()
  }

  const switchSession = async (sessionId: string): Promise<void> => {
    if (sessionId === currentSessionId) {
      return
    }
    const target = sessions.find((session) => session.id === sessionId)
    if (!target) {
      return
    }
    const now = new Date().toISOString()
    sessions = sessions.map((session) =>
      session.id === sessionId ? { ...session, lastOpenedAt: now } : session
    )
    saveSessionCatalog(sessions)
    await backend.destroy(true)
    await attachSession(target)
  }

  const createSessionForFolder = async (path: string): Promise<void> => {
    const state = createInitialState({}, sessions, [])
    const created = createSessionFromCurrentState(state, basename(path) || path, path)
    sessions = created.sessions
    saveSessionCatalog(sessions)
    await backend.destroy(true)
    await attachSession(created.session)
  }

  const deleteSession = async (sessionId: string): Promise<void> => {
    sessions = deleteSessionRecords(sessions, sessionId)
    saveSessionCatalog(sessions)
    if (sessionId !== currentSessionId) {
      broadcastSessions()
      return
    }
    await backend.destroy(true)
    const next = findMostRecentSession(sessions)
    await (next === undefined ? createSessionForFolder(process.cwd()) : attachSession(next))
  }

  backend.on('render', (tabId, viewport, modes) => {
    lastRender.set(tabId, { modes, viewport })
    if (tabId === activeTabId) {
      send({ modes, t: 'render', tabId, viewport })
    }
  })
  backend.on('tabActivity', (tabId, activity) => {
    tabs = tabs.map((tab) => (tab.id === tabId ? { ...tab, activity } : tab))
    send({ activity, t: 'tabActivity', tabId })
  })
  backend.on('sessionActivity', (sessionId, status) => {
    sessionStatuses.set(sessionId, status)
    broadcastSessions()
  })
  backend.on('exit', (tabId, code) => {
    send({ code, t: 'exit', tabId })
    tabs = tabs.filter((tab) => tab.id !== tabId)
    lastRender.delete(tabId)
    if (activeTabId === tabId) {
      activeTabId = tabs.at(-1)?.id ?? null
      if (activeTabId !== null) {
        backend.setActiveTab(activeTabId)
      }
    }
    broadcastTabs()
  })
  backend.on('error', (tabId, message) => {
    send({ message, t: 'error', tabId })
  })

  // Resolve the initial session: most-recent from the catalog, else a fresh one
  // for the current working directory.
  sessions = loadSessionCatalog()
  let initial = findMostRecentSession(sessions)
  if (initial === undefined) {
    const cwd = process.cwd()
    const created = createSessionFromCurrentState(
      createInitialState({}, sessions, []),
      basename(cwd) || cwd,
      cwd
    )
    sessions = created.sessions
    saveSessionCatalog(sessions)
    initial = created.session
  }
  await attachSession(initial)

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
        switch (message.t) {
          case 'input':
            if (activeTabId !== null) {
              backend.write(activeTabId, message.data)
            }
            break
          case 'resize':
            cols = message.cols
            rows = message.rows
            backend.resizeAll(cols, rows)
            break
          case 'scroll':
            if (activeTabId !== null) {
              backend.scrollViewport(activeTabId, message.deltaLines)
            }
            break
          case 'setActiveTab':
            activeTabId = message.tabId
            backend.setActiveTab(message.tabId)
            replayActive()
            break
          case 'createTab':
            createTab(message.assistant)
            break
          case 'closeTab':
            backend.disposeSession(message.tabId)
            break
          case 'switchSession':
            void switchSession(message.sessionId)
            break
          case 'createSession':
            void createSessionForFolder(message.path)
            break
          case 'deleteSession':
            void deleteSession(message.sessionId)
            break
          default:
            break
        }
      },
      open(ws) {
        activeWs = ws
        sendInit()
        replayActive()
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
  // Host-only mode: never resolve, so index.tsx does not fall through to the
  // @opentui TUI renderer. Bun.serve keeps the process alive in the background.
  await new Promise<never>(() => {})
}
