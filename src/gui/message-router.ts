import type { ServerWebSocket } from 'bun'

import { actions } from '@brimveyn/aimux-config'
import { basename } from 'node:path'

import type { SessionBackend } from '../session-backend/types'
import type { GuiClientMessage, GuiServerMessage } from './protocol'
import type { GuiRuntime } from './runtime'

import {
  handleCreateProjectEffect,
  handleDeleteProjectEffect,
  handleSwitchProjectEffect,
} from '../app-runtime/project-actions'
import { logDebug } from '../debug/input-log'
import { deriveModeId } from '../input/modes/bridge'
import { dispatchIntent } from './intent-handlers'

/** Per-connection state held by the transport for rate limiting. */
export interface ActiveWsState {
  ws: ServerWebSocket<unknown>
  // Token bucket for `requestBytes`: capacity 10, refill 10/s (1 per 100ms).
  // Sized to the frontend's mount pattern (one dump per fresh xterm), with
  // headroom for the StrictMode double-mount + brief re-mount bursts.
  requestBytesTokens: number
  requestBytesLastRefillMs: number
}

export const REQUEST_BYTES_CAPACITY = 10
export const REQUEST_BYTES_REFILL_PER_SEC = 10

export function tryConsumeRequestBytesToken(state: ActiveWsState): boolean {
  const now = performance.now()
  const elapsed = now - state.requestBytesLastRefillMs
  if (elapsed > 0) {
    const refill = (elapsed / 1000) * REQUEST_BYTES_REFILL_PER_SEC
    if (refill > 0) {
      state.requestBytesTokens = Math.min(REQUEST_BYTES_CAPACITY, state.requestBytesTokens + refill)
      state.requestBytesLastRefillMs = now
    }
  }
  if (state.requestBytesTokens >= 1) {
    state.requestBytesTokens -= 1
    return true
  }
  return false
}

export interface MessageContext {
  runtime: GuiRuntime
  /** Direct backend handle for verbs that bypass the reducer (write/scroll/resize). */
  backend: SessionBackend
  send: (msg: GuiServerMessage) => void
  /** Per-connection state; null only if the connection has gone away. */
  activeWsState: ActiveWsState | null
}

// One handler per `t:` variant. Keeping these as a switch (rather than a
// dispatch table) preserves TypeScript's discriminated-union narrowing —
// each case branch sees the precise message shape without explicit casts.
export function dispatchClientMessage(message: GuiClientMessage, ctx: MessageContext): void {
  const { backend, runtime } = ctx
  const { dispatch, pipeline } = runtime
  const state = runtime.getState()
  switch (message.t) {
    case 'key':
      handleKey(message, pipeline)
      break
    case 'paste':
      handlePaste(message, state, backend, dispatch)
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
      handleResizeTab(message, state, backend, dispatch)
      break
    case 'paneActivate':
      dispatch({ tabId: message.tabId, type: 'set-active-tab' })
      break
    case 'requestBytes':
      void handleRequestBytes(message, ctx)
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
      dispatch({ type: 'open-quotas-modal' })
      break
    case 'closeTab':
      dispatch({ tabId: message.tabId, type: 'close-tab' })
      backend.disposeSession(message.tabId)
      // The snippet-trigger driver lives inside the runtime; its per-tab
      // teardown is also invoked by the backend 'exit' subscriber wired
      // there, so we don't need to call it explicitly here.
      break
    case 'switchProject': {
      const session = state.projects.find((entry) => entry.id === message.projectId)
      if (session) {
        handleSwitchProjectEffect(state, backend, dispatch, session)
      }
      break
    }
    case 'createProject':
      handleCreateProjectEffect(
        state,
        dispatch,
        basename(message.path) || message.path,
        message.path
      )
      break
    case 'deleteProject':
      handleDeleteProjectEffect(state, backend, dispatch, message.projectId)
      break
    case 'openWorkspaceMove':
      dispatch({
        sourceWorkspaceId: message.sourceWorkspaceId,
        type: 'open-workspace-move-modal',
      })
      break
    case 'toggleWorkspaceMoveDelete':
      dispatch({ type: 'toggle-workspace-move-delete' })
      break
    case 'openSnippetEditor':
      dispatch({ snippetId: message.snippetId, type: 'open-snippet-editor' })
      break
    case 'enterInsertMode': {
      // Click-driven equivalent of the `i` mapping in navigation mode. Funnels
      // through the same KeyResult the keymap would produce so the mode-pipeline
      // and focusMode stay in sync.
      const enterState = runtime.getState()
      const enterResult = actions.enterInsert({ state: enterState })
      if (enterResult !== null) {
        pipeline.processKeyResult(enterResult, deriveModeId(enterState))
      }
      break
    }
    case 'leaveInsertMode': {
      const leaveState = runtime.getState()
      if (leaveState.focusMode === 'terminal-input') {
        pipeline.processKeyResult(actions.leaveTerminalInput, deriveModeId(leaveState))
      }
      break
    }
    case 'intent':
      dispatchIntent(message.intent, runtime)
      break
    default:
      break
  }
}

function handleKey(
  message: Extract<GuiClientMessage, { t: 'key' }>,
  pipeline: GuiRuntime['pipeline']
): void {
  pipeline.handleKey({
    ctrl: message.ctrl,
    meta: message.meta,
    name: message.name,
    sequence: message.sequence,
    shift: message.shift,
  })
}

function handlePaste(
  message: Extract<GuiClientMessage, { t: 'paste' }>,
  state: ReturnType<GuiRuntime['getState']>,
  backend: SessionBackend,
  dispatch: GuiRuntime['dispatch']
): void {
  if (state.focusMode === 'command-edit') {
    const sanitized = message.text.replaceAll(/\r\n?/g, '\n')
    dispatch({ char: sanitized, type: 'update-command-edit' })
    return
  }
  // GUI-only behaviour: a user-driven Cmd+V is unambiguous — they want the
  // text in the active terminal regardless of which mode the host happens to
  // be in. The TUI never sees this path (paste there is keystroke-driven
  // through the keymap), so writing in nav/modal/git mode here can't break
  // any TUI invariant; it just spares the user from "click pane first to
  // enter insert" before every paste.
  if (state.activeTabId !== null) {
    const tab = state.tabs.find((entry) => entry.id === state.activeTabId)
    const wrapped =
      tab?.terminalModes.bracketedPasteMode === true
        ? `\x1b[200~${message.text}\x1b[201~`
        : message.text
    backend.write(state.activeTabId, wrapped)
  }
}

function handleResizeTab(
  message: Extract<GuiClientMessage, { t: 'resizeTab' }>,
  state: ReturnType<GuiRuntime['getState']>,
  backend: SessionBackend,
  dispatch: GuiRuntime['dispatch']
): void {
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
    (state.layout.terminalCols !== message.cols || state.layout.terminalRows !== message.rows)
  ) {
    dispatch({ cols: message.cols, rows: message.rows, type: 'set-terminal-size' })
  }
}

async function handleRequestBytes(
  message: Extract<GuiClientMessage, { t: 'requestBytes' }>,
  ctx: MessageContext
): Promise<void> {
  // The frontend xterm.js pulls its scrollback on mount (one request
  // per fresh instance). Serialize the current buffer and send it.
  // The remote backend's serialize is async (IPC round-trip); fire
  // and forget — the client already RIS-resets before applying.
  if (!ctx.runtime.hasTab(message.tabId)) {
    logDebug('gui.host.requestBytes.unknownTab', { tabId: message.tabId })
    return
  }
  if (ctx.activeWsState !== null && !tryConsumeRequestBytesToken(ctx.activeWsState)) {
    logDebug('gui.host.requestBytes.rateLimited', { tabId: message.tabId })
    return
  }
  const data = await ctx.runtime.serializeBuffer(message.tabId)
  if (data !== null) {
    // Distinct from live `bytes`: the client RIS-resets its xterm before
    // writing this, so receiving the dump any number of times (StrictMode
    // double-mount, reconnect, …) converges to a single copy.
    ctx.send({ data, t: 'bytesReset', tabId: message.tabId })
  }
}
