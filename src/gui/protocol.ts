import type { AssistantId, TabActivity, TerminalModeState, TerminalSnapshot } from '../state/types'

/**
 * Thin WebSocket message contract between the GUI host (`src/gui/host.ts`) and
 * the browser/WebView frontend (`src/gui/web/app.js`).
 *
 * This is intentionally NOT the daemon IPC protocol (`src/ipc/protocol.ts`):
 * the host already speaks IPC to the daemon via a RemoteSessionBackend and only
 * needs to expose a small, unversioned surface to the page. WebSocket frames are
 * already message-delimited, so messages are plain JSON (no length framing).
 */

/** Lightweight tab descriptor sent to the frontend for the tab strip. */
export interface TabMeta {
  id: string
  title: string
  assistant: AssistantId
  activity?: TabActivity
}

/** Messages sent from the browser to the host. */
export type GuiClientMessage =
  | { t: 'input'; data: string }
  | { t: 'resize'; cols: number; rows: number }
  | { t: 'scroll'; deltaLines: number }
  | { t: 'setActiveTab'; tabId: string }
  | { t: 'createTab'; assistant: AssistantId }
  | { t: 'closeTab'; tabId: string }

/** Messages sent from the host to the browser. */
export type GuiServerMessage =
  | {
      t: 'init'
      tabs: TabMeta[]
      activeTabId: string | null
      cols: number
      rows: number
    }
  | { t: 'render'; tabId: string; viewport: TerminalSnapshot; modes: TerminalModeState }
  | { t: 'exit'; tabId: string; code: number }
  | { t: 'error'; tabId: string; message: string }
  | { t: 'tabActivity'; tabId: string; activity: TabActivity }
  | { t: 'tabs'; tabs: TabMeta[]; activeTabId: string | null }

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Parse and validate an inbound client message. Returns null for anything
 * malformed so the host can ignore it rather than crash the connection.
 */
export function parseClientMessage(raw: string): GuiClientMessage | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isObjectRecord(value) || typeof value.t !== 'string') {
    return null
  }

  switch (value.t) {
    case 'input':
      return typeof value.data === 'string' ? { data: value.data, t: 'input' } : null
    case 'resize':
      return typeof value.cols === 'number' && typeof value.rows === 'number'
        ? { cols: value.cols, rows: value.rows, t: 'resize' }
        : null
    case 'scroll':
      return typeof value.deltaLines === 'number'
        ? { deltaLines: value.deltaLines, t: 'scroll' }
        : null
    case 'setActiveTab':
      return typeof value.tabId === 'string' ? { t: 'setActiveTab', tabId: value.tabId } : null
    case 'createTab':
      return typeof value.assistant === 'string'
        ? { assistant: value.assistant, t: 'createTab' }
        : null
    case 'closeTab':
      return typeof value.tabId === 'string' ? { t: 'closeTab', tabId: value.tabId } : null
    default:
      return null
  }
}
