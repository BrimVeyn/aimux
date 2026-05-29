import type { ServerWebSocket } from 'bun'

import type { AssistantId, TerminalModeState, TerminalSnapshot } from '../state/types'

import { logDebug } from '../debug/input-log'
import { ASSISTANT_OPTIONS } from '../pty/command-registry'
import { createSessionBackend } from '../session-backend/bootstrap'
import { launchShell } from './launch-shell'
import { type GuiServerMessage, parseClientMessage, type TabMeta } from './protocol'

const GUI_SESSION_ID = 'gui'
const GUI_PORT = 7878
const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

interface CachedRender {
  viewport: TerminalSnapshot
  modes: TerminalModeState
}

export async function runGui(): Promise<void> {
  const backend = await createSessionBackend()

  let tabs: TabMeta[] = []
  let activeTabId: string | null = null
  let cols = DEFAULT_COLS
  let rows = DEFAULT_ROWS
  let activeWs: ServerWebSocket<unknown> | null = null
  const lastRender = new Map<string, CachedRender>()

  const send = (message: GuiServerMessage): void => {
    activeWs?.send(JSON.stringify(message))
  }

  const broadcastTabs = (): void => {
    send({ activeTabId, t: 'tabs', tabs })
  }

  const attachResult = await backend.attach({ cols, rows, sessionId: GUI_SESSION_ID })
  if (attachResult !== null) {
    tabs = attachResult.tabs.map((tab) => ({
      activity: tab.activity,
      assistant: tab.assistant,
      id: tab.id,
      title: tab.title,
    }))
    activeTabId = attachResult.activeTabId
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
      cwd: process.cwd(),
      rows,
      tabId,
      title: option.label,
    })
    tabs = [...tabs, { assistant: option.id, id: tabId, title: option.label }]
    activeTabId = tabId
    backend.setActiveTab(tabId)
    broadcastTabs()
  }

  // Start with a terminal tab when the session is empty.
  if (tabs.length === 0) {
    createTab('terminal')
  } else if (activeTabId !== null) {
    backend.setActiveTab(activeTabId)
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

  const replayActive = (): void => {
    if (activeTabId === null) {
      return
    }
    const cached = lastRender.get(activeTabId)
    if (cached) {
      send({ modes: cached.modes, t: 'render', tabId: activeTabId, viewport: cached.viewport })
    }
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
          default:
            break
        }
      },
      open(ws) {
        activeWs = ws
        send({ activeTabId, cols, rows, t: 'init', tabs })
        replayActive()
      },
    },
  })

  const port = server.port ?? GUI_PORT
  const url = `http://127.0.0.1:${port}`
  process.stdout.write(`aimux gui host listening on ${url} (ws ${url}/ws)\n`)
  logDebug('gui.host.listening', { port })

  const shell = await launchShell(port)
  if (shell === null) {
    process.stdout.write(
      'No built GUI shell found.\n' +
        '  Build once (standalone):  cd desktop && bun run tauri build\n' +
        '  Or live dev (HMR):        cd desktop && bun run tauri dev\n'
    )
  } else {
    await shell.exited
    await backend.destroy()
    void server.stop()
    process.exit(0)
  }
}
