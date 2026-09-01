import type { AppStateProjection, SplitDirection } from './projection'

import { type GuiIntent, parseGuiIntent } from './intents'

// Thin WebSocket contract between the GUI host and the browser/WebView renderer.
// The host runs aimux's real brain (reducer + keymaps + modes + side-effects);
// the browser sends normalized input and renders the streamed AppState. This is
// NOT the daemon IPC protocol. WS frames are message-delimited, so plain JSON.

/** Normalised keyboard event in aimux's KeyInput shape (wire-level). */
export interface KeyPayload {
  name: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  sequence: string
}

/** A browser keyboard event normalised into aimux's KeyInput shape. */
export interface KeyMessage extends KeyPayload {
  t: 'key'
}

export type GuiClientMessage =
  | KeyMessage
  | { t: 'paste'; text: string }
  | { t: 'scroll'; deltaLines: number }
  | { t: 'resizeWindow'; cols: number; rows: number }
  | { t: 'resizeTab'; tabId: string; cols: number; rows: number }
  | { t: 'paneActivate'; tabId: string }
  | { t: 'modalSelect'; index: number }
  | { t: 'modalConfirm'; index?: number }
  | { t: 'setSplitRatio'; tabId: string; ratio: number; axis: SplitDirection }
  | { t: 'openNewTab' }
  | { t: 'closeTab'; tabId: string }
  | { t: 'switchProject'; projectId: string }
  | { t: 'createProject'; path: string }
  | { t: 'deleteProject'; projectId: string }
  | { t: 'openWorkspaceMove'; sourceWorkspaceId: string }
  | { t: 'requestBytes'; tabId: string }
  | { t: 'toggleWorkspaceMoveDelete' }
  | { t: 'openAiUsageModal' }
  | { t: 'openSnippetEditor'; snippetId?: string }
  | { t: 'enterInsertMode' }
  | { t: 'leaveInsertMode' }
  | { t: 'intent'; intent: GuiIntent }

export type ToastLevel = 'info' | 'success' | 'error'

export type GuiServerMessage =
  | { t: 'hello'; version: number; capabilities: string[] }
  | { t: 'state'; projection: AppStateProjection }
  | { t: 'bytes'; tabId: string; data: string }
  | { t: 'bytesReset'; tabId: string; data: string }
  | { t: 'exit'; tabId: string; code: number }
  | { t: 'error'; tabId: string; message: string }
  | { t: 'toast'; level: ToastLevel; message: string }

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isBool(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

/** Parse and validate an inbound client message; null if malformed. */
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
    case 'key':
      return typeof value.name === 'string' &&
        typeof value.sequence === 'string' &&
        isBool(value.ctrl) &&
        isBool(value.meta) &&
        isBool(value.shift)
        ? {
            ctrl: value.ctrl,
            meta: value.meta,
            name: value.name,
            sequence: value.sequence,
            shift: value.shift,
            t: 'key',
          }
        : null
    case 'paste':
      return typeof value.text === 'string' ? { t: 'paste', text: value.text } : null
    case 'scroll':
      return typeof value.deltaLines === 'number'
        ? { deltaLines: value.deltaLines, t: 'scroll' }
        : null
    case 'resizeWindow':
      return typeof value.cols === 'number' && typeof value.rows === 'number'
        ? { cols: value.cols, rows: value.rows, t: 'resizeWindow' }
        : null
    case 'resizeTab':
      return typeof value.tabId === 'string' &&
        typeof value.cols === 'number' &&
        typeof value.rows === 'number'
        ? { cols: value.cols, rows: value.rows, t: 'resizeTab', tabId: value.tabId }
        : null
    case 'paneActivate':
      return typeof value.tabId === 'string' ? { t: 'paneActivate', tabId: value.tabId } : null
    case 'modalSelect':
      return typeof value.index === 'number' ? { index: value.index, t: 'modalSelect' } : null
    case 'modalConfirm':
      if (value.index !== undefined && typeof value.index !== 'number') {
        return null
      }
      return value.index === undefined
        ? { t: 'modalConfirm' }
        : { index: value.index, t: 'modalConfirm' }
    case 'setSplitRatio': {
      if (typeof value.tabId !== 'string' || typeof value.ratio !== 'number') {
        return null
      }
      if (value.axis !== 'horizontal' && value.axis !== 'vertical') {
        return null
      }
      return { axis: value.axis, ratio: value.ratio, t: 'setSplitRatio', tabId: value.tabId }
    }
    case 'openNewTab':
      return { t: 'openNewTab' }
    case 'closeTab':
      return typeof value.tabId === 'string' ? { t: 'closeTab', tabId: value.tabId } : null
    case 'switchProject':
      return typeof value.projectId === 'string'
        ? { projectId: value.projectId, t: 'switchProject' }
        : null
    case 'createProject':
      return typeof value.path === 'string' ? { path: value.path, t: 'createProject' } : null
    case 'deleteProject':
      return typeof value.projectId === 'string'
        ? { projectId: value.projectId, t: 'deleteProject' }
        : null
    case 'openWorkspaceMove':
      return typeof value.sourceWorkspaceId === 'string'
        ? { sourceWorkspaceId: value.sourceWorkspaceId, t: 'openWorkspaceMove' }
        : null
    case 'requestBytes':
      return typeof value.tabId === 'string' ? { t: 'requestBytes', tabId: value.tabId } : null
    case 'toggleWorkspaceMoveDelete':
      return { t: 'toggleWorkspaceMoveDelete' }
    case 'openAiUsageModal':
      return { t: 'openAiUsageModal' }
    case 'openSnippetEditor':
      if (value.snippetId !== undefined && typeof value.snippetId !== 'string') {
        return null
      }
      return value.snippetId === undefined
        ? { t: 'openSnippetEditor' }
        : { snippetId: value.snippetId, t: 'openSnippetEditor' }
    case 'enterInsertMode':
      return { t: 'enterInsertMode' }
    case 'leaveInsertMode':
      return { t: 'leaveInsertMode' }
    case 'intent': {
      const intent = parseGuiIntent(value.intent)
      return intent === null ? null : { intent, t: 'intent' }
    }
    default:
      return null
  }
}
