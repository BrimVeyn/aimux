import type {
  ProjectSnapshotV1,
  TabSession,
  TerminalModeState,
  TerminalSnapshot,
} from '../state/types'

import { isProjectSnapshotV1 } from '../state/validation'
import {
  getProcessVersion,
  IpcProtocolError,
  MessageDecoder,
  negotiateProtocolVersion,
} from './protocol'

// v5: backend owns scroll position end to end. Removed the per-tab scroll
// `intent`/`intents` from resize messages and the `reapplyScrollIntent`
// message. Min is raised in lockstep so a pre-v5 peer (which could still send
// the dropped message) can't negotiate a now-incompatible version.
//
// v6: `createTab` carries an optional `env` payload that the TM merges into
// the spawned PTY. Daemon uses it to inject `AIMUX_HOOK_URL_FILE` /
// `AIMUX_PANE_ID` for the Claude Code hook bridge. A pre-v6 TM silently
// drops the field, so Min is raised in lockstep to force a fresh TM that
// will actually forward env to the spawn.
//
// v7: `TerminalSpan` carries optional `fgPalette`/`bgPalette` (ANSI 0-255
// indices) instead of pre-converting palette cells to hex. The client
// resolves them against the host terminal's actual palette (queried via
// OSC 4 at startup) so user themes (Ghostty, iTerm2, …) show through
// instead of hardcoded xterm defaults. Cross-version mixing breaks colors
// either way (pre-v7 TM → new client never sees the indices; new TM →
// pre-v7 client ignores them and falls back to the theme default), so Min
// is raised in lockstep to force matching binaries.
//
// v9: additive — `tabMetadata` updates titles and auto-rename state without
// restarting PTYs. Capability-gated; MIN remains at 8.
//
// v10: additive — `workerName` persists a project-scoped orchestration
// handle on tabs created through the headless worker facade.
//
// v11: breaking release boundary — force a fresh terminal-manager so named
// worker metadata is guaranteed to survive daemon reattach and process swaps.
//
// v13: breaking release boundary — the TM now answers a child's OSC 10/11/12/4
// colour probes from `AIMUX_TERM_COLORS` on the tab env (see pty-manager).
// Nothing on the wire changed, but the fix lives in the TM process and a TM
// that predates it keeps the old silence for every new tab — which is what
// makes a probing program (opencode) paint an opaque background over a
// transparent pane. Raising MIN turns "silently still broken" into the one
// forced restart.
export const MANAGER_PROTOCOL_MIN_VERSION = 13
export const MANAGER_PROTOCOL_VERSION = 13

/**
 * Capability strings advertised by *this* process in its `helloResult`. New
 * additive TM features should be introduced here rather than via a MIN bump
 * — bumping MIN forces a fresh TM and kills every PTY. See
 * `src/ipc/README.md`.
 */
export const MANAGER_PROTOCOL_CAPABILITIES: readonly string[] = [
  'setBroadcastEnabled',
  'createTabWorkspaceId',
  'tabMetadata',
  'workerMetadata',
]

export const MANAGER_CAPABILITY_TAB_METADATA = 'tabMetadata'
export const MANAGER_CAPABILITY_WORKER_METADATA = 'workerMetadata'

/**
 * Capability name a daemon must observe on the TM's helloResult before
 * sending `setBroadcastEnabled`.
 */
export const MANAGER_CAPABILITY_SET_BROADCAST_ENABLED = 'setBroadcastEnabled'

/**
 * Version-based fallback for `setBroadcastEnabled`. TM binaries that predate
 * the capability field (built before the additive-contract migration) don't
 * advertise capabilities, but any TM at v4+ speaks the request. Callers gate
 * on `capabilities.has('setBroadcastEnabled') || selectedVersion >= this`.
 *
 * Rolling-upgrade window: new daemon + old TM (still v4+) would otherwise
 * silently regress to always-broadcasting, spiking CPU and IPC traffic.
 */
export const MANAGER_PROTOCOL_BROADCAST_GATE_VERSION = 4

export interface ManagerHelloRequest {
  minVersion: number
  maxVersion: number
}

export interface ManagerHelloResult {
  minVersion: number
  maxVersion: number
  processVersion: string
  selectedVersion: number
  /**
   * Feature flags. Always present on the typed shape; older peers that did
   * not yet advertise capabilities are normalised to `[]` at parse time.
   */
  capabilities: string[]
}

export interface ManagerAttachRequest {
  protocolVersion: number
  projectId: string
  cols: number
  rows: number
  projectSnapshot?: ProjectSnapshotV1
}

export interface ManagerAttachResult {
  protocolVersion: number
  tabs: TabSession[]
  activeTabId: string | null
}

export type ManagerRequest =
  | { id: string; type: 'hello'; payload: ManagerHelloRequest }
  | { id: string; type: 'attachSession'; payload: ManagerAttachRequest }
  | {
      id: string
      type: 'createTab'
      payload: {
        projectId: string
        tabId: string
        assistant: TabSession['assistant']
        title: string
        command: string
        args?: string[]
        cols: number
        rows: number
        cwd?: string
        /** Extra env vars merged into the spawned PTY's environment. */
        env?: Record<string, string>
        /**
         * Workspace this tab belongs to (UI grouping). Capability-gated on
         * `createTabWorkspaceId`. Pre-cap TMs silently drop the field, which
         * matches the previous behaviour where every new tab had
         * `workspaceId = undefined`.
         */
        workspaceId?: string
        workerName?: string
        autoRenameStatus?: 'eligible' | 'attempted'
      }
    }
  | { id: string; type: 'write'; payload: { projectId: string; tabId: string; data: string } }
  | {
      id: string
      type: 'updateTabMetadata'
      payload: {
        projectId: string
        tabId: string
        title?: string
        autoRenameStatus?: 'eligible' | 'attempted'
      }
    }
  | {
      id: string
      type: 'resizeClient'
      payload: {
        projectId: string
        cols: number
        rows: number
      }
    }
  | {
      id: string
      type: 'resizeTab'
      payload: {
        projectId: string
        tabId: string
        cols: number
        rows: number
      }
    }
  | {
      id: string
      type: 'scrollToBottom'
      payload: { projectId: string; tabId: string }
    }
  | {
      id: string
      type: 'scroll'
      payload: { projectId: string; tabId: string; deltaLines: number }
    }
  | { id: string; type: 'setActiveTab'; payload: { projectId: string; tabId: string | null } }
  | { id: string; type: 'closeTab'; payload: { projectId: string; tabId: string } }
  | { id: string; type: 'disposeSession'; payload: { projectId: string } }
  | { id: string; type: 'ping'; payload: Record<string, never> }
  | { id: string; type: 'setBroadcastEnabled'; payload: { enabled: boolean } }

export type ManagerResponse =
  | { id: string; type: 'helloResult'; payload: ManagerHelloResult }
  | { id: string; type: 'ok'; payload: Record<string, never> }
  | { id: string; type: 'attachResult'; payload: ManagerAttachResult }
  | { id: string; type: 'error'; payload: { message: string } }

export type ManagerEvent =
  | {
      type: 'tabRender'
      payload: {
        projectId: string
        tabId: string
        viewport: TerminalSnapshot
        terminalModes: TerminalModeState
      }
    }
  | { type: 'tabExit'; payload: { projectId: string; tabId: string; exitCode: number } }
  | { type: 'tabError'; payload: { projectId: string; tabId: string; message: string } }

export type ManagerMessage = ManagerRequest | ManagerResponse | ManagerEvent

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isObjectRecord(value)) return false
  for (const v of Object.values(value)) {
    if (!isString(v)) return false
  }
  return true
}

function isTerminalSpan(value: unknown): boolean {
  return (
    isObjectRecord(value) &&
    isString(value.text) &&
    (value.fg === undefined || isString(value.fg)) &&
    (value.bg === undefined || isString(value.bg)) &&
    (value.fgPalette === undefined || isFiniteNumber(value.fgPalette)) &&
    (value.bgPalette === undefined || isFiniteNumber(value.bgPalette)) &&
    (value.bold === undefined || typeof value.bold === 'boolean') &&
    (value.italic === undefined || typeof value.italic === 'boolean') &&
    (value.underline === undefined || typeof value.underline === 'boolean') &&
    (value.cursor === undefined || typeof value.cursor === 'boolean')
  )
}

function isTerminalSnapshot(value: unknown): value is TerminalSnapshot {
  return (
    isObjectRecord(value) &&
    Array.isArray(value.lines) &&
    value.lines.every(
      (line) =>
        isObjectRecord(line) && Array.isArray(line.spans) && line.spans.every(isTerminalSpan)
    ) &&
    isFiniteNumber(value.viewportY) &&
    isFiniteNumber(value.baseY) &&
    typeof value.cursorVisible === 'boolean' &&
    (value.cursorStyle === undefined ||
      value.cursorStyle === 'block' ||
      value.cursorStyle === 'underline' ||
      value.cursorStyle === 'bar' ||
      value.cursorStyle === 'default') &&
    (value.cursorBlink === undefined || typeof value.cursorBlink === 'boolean') &&
    (value.cursorRow === undefined || isFiniteNumber(value.cursorRow)) &&
    (value.cursorCol === undefined || isFiniteNumber(value.cursorCol))
  )
}

function isTerminalModeState(value: unknown): value is TerminalModeState {
  return (
    isObjectRecord(value) &&
    (value.mouseTrackingMode === 'none' ||
      value.mouseTrackingMode === 'x10' ||
      value.mouseTrackingMode === 'vt200' ||
      value.mouseTrackingMode === 'drag' ||
      value.mouseTrackingMode === 'any') &&
    typeof value.sendFocusMode === 'boolean' &&
    typeof value.alternateScrollMode === 'boolean' &&
    typeof value.isAlternateBuffer === 'boolean' &&
    typeof value.bracketedPasteMode === 'boolean'
  )
}

function isAttachResult(value: unknown): value is ManagerAttachResult {
  return (
    isObjectRecord(value) &&
    isFiniteNumber(value.protocolVersion) &&
    Array.isArray(value.tabs) &&
    value.tabs.every((tab) => isObjectRecord(tab) && isString(tab.id)) &&
    isNullableString(value.activeTabId)
  )
}

function isHelloResult(value: unknown): value is ManagerHelloResult {
  return (
    isObjectRecord(value) &&
    isFiniteNumber(value.minVersion) &&
    isFiniteNumber(value.maxVersion) &&
    isFiniteNumber(value.selectedVersion) &&
    isString(value.processVersion) &&
    // Wire-back-compat: legacy peers omit capabilities entirely. The parser
    // normalises that to `[]` before returning the typed shape.
    (value.capabilities === undefined || isStringArray(value.capabilities))
  )
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new IpcProtocolError(message)
  }
}

function normaliseManagerCapabilities(payload: Record<string, unknown>): void {
  if (!Array.isArray(payload.capabilities)) {
    payload.capabilities = []
  }
}

export function selectManagerProtocolVersion(payload: ManagerHelloRequest): number | null {
  return negotiateProtocolVersion(
    payload.minVersion,
    payload.maxVersion,
    MANAGER_PROTOCOL_MIN_VERSION,
    MANAGER_PROTOCOL_VERSION
  )
}

export function createManagerHelloResult(selectedVersion: number): ManagerHelloResult {
  return {
    capabilities: [...MANAGER_PROTOCOL_CAPABILITIES],
    maxVersion: MANAGER_PROTOCOL_VERSION,
    minVersion: MANAGER_PROTOCOL_MIN_VERSION,
    processVersion: getProcessVersion(),
    selectedVersion,
  }
}

export function parseManagerRequest(value: unknown): ManagerRequest {
  assert(isObjectRecord(value), 'IPC message must be an object')
  assert(isString(value.id), 'IPC request id must be a string')
  assert(isString(value.type), 'IPC request type must be a string')
  assert(isObjectRecord(value.payload), 'IPC request payload must be an object')

  switch (value.type) {
    case 'hello':
      assert(isFiniteNumber(value.payload.minVersion), 'hello.minVersion must be a number')
      assert(isFiniteNumber(value.payload.maxVersion), 'hello.maxVersion must be a number')
      return value as ManagerRequest
    case 'attachSession':
      assert(
        isFiniteNumber(value.payload.protocolVersion),
        'attachSession.protocolVersion must be a number'
      )
      assert(isString(value.payload.projectId), 'attachSession.projectId must be a string')
      assert(isFiniteNumber(value.payload.cols), 'attachSession.cols must be a number')
      assert(isFiniteNumber(value.payload.rows), 'attachSession.rows must be a number')
      assert(
        value.payload.projectSnapshot === undefined ||
          isProjectSnapshotV1(value.payload.projectSnapshot),
        'attachSession.projectSnapshot must be a valid project snapshot'
      )
      return value as ManagerRequest
    case 'createTab':
      assert(isString(value.payload.projectId), 'createTab.projectId must be a string')
      assert(isString(value.payload.tabId), 'createTab.tabId must be a string')
      assert(
        isString(value.payload.assistant) && value.payload.assistant.length > 0,
        'createTab.assistant must be a non-empty string'
      )
      assert(isString(value.payload.title), 'createTab.title must be a string')
      assert(isString(value.payload.command), 'createTab.command must be a string')
      assert(
        value.payload.args === undefined || isStringArray(value.payload.args),
        'createTab.args must be a string array'
      )
      assert(isFiniteNumber(value.payload.cols), 'createTab.cols must be a number')
      assert(isFiniteNumber(value.payload.rows), 'createTab.rows must be a number')
      assert(
        value.payload.cwd === undefined || isString(value.payload.cwd),
        'createTab.cwd must be a string'
      )
      assert(
        value.payload.env === undefined || isStringRecord(value.payload.env),
        'createTab.env must be a string-keyed string record'
      )
      assert(
        value.payload.workspaceId === undefined || isString(value.payload.workspaceId),
        'createTab.workspaceId must be a string when present'
      )
      assert(
        value.payload.workerName === undefined || isString(value.payload.workerName),
        'createTab.workerName must be a string when present'
      )
      assert(
        value.payload.autoRenameStatus === undefined ||
          value.payload.autoRenameStatus === 'eligible' ||
          value.payload.autoRenameStatus === 'attempted',
        'createTab.autoRenameStatus is invalid'
      )
      return value as ManagerRequest
    case 'write':
      assert(isString(value.payload.projectId), 'write.projectId must be a string')
      assert(isString(value.payload.tabId), 'write.tabId must be a string')
      assert(isString(value.payload.data), 'write.data must be a string')
      return value as ManagerRequest
    case 'updateTabMetadata':
      assert(isString(value.payload.projectId), 'updateTabMetadata.projectId must be a string')
      assert(isString(value.payload.tabId), 'updateTabMetadata.tabId must be a string')
      assert(
        value.payload.title === undefined || isString(value.payload.title),
        'updateTabMetadata.title must be a string when present'
      )
      assert(
        value.payload.autoRenameStatus === undefined ||
          value.payload.autoRenameStatus === 'eligible' ||
          value.payload.autoRenameStatus === 'attempted',
        'updateTabMetadata.autoRenameStatus is invalid'
      )
      return value as ManagerRequest
    case 'resizeClient':
      assert(isString(value.payload.projectId), 'resizeClient.projectId must be a string')
      assert(isFiniteNumber(value.payload.cols), 'resizeClient.cols must be a number')
      assert(isFiniteNumber(value.payload.rows), 'resizeClient.rows must be a number')
      return value as ManagerRequest
    case 'resizeTab':
      assert(isString(value.payload.projectId), 'resizeTab.projectId must be a string')
      assert(isString(value.payload.tabId), 'resizeTab.tabId must be a string')
      assert(isFiniteNumber(value.payload.cols), 'resizeTab.cols must be a number')
      assert(isFiniteNumber(value.payload.rows), 'resizeTab.rows must be a number')
      return value as ManagerRequest
    case 'scroll':
      assert(isString(value.payload.projectId), 'scroll.projectId must be a string')
      assert(isString(value.payload.tabId), 'scroll.tabId must be a string')
      assert(isFiniteNumber(value.payload.deltaLines), 'scroll.deltaLines must be a number')
      return value as ManagerRequest
    case 'scrollToBottom':
      assert(isString(value.payload.projectId), 'scrollToBottom.projectId must be a string')
      assert(isString(value.payload.tabId), 'scrollToBottom.tabId must be a string')
      return value as ManagerRequest
    case 'setActiveTab':
      assert(isString(value.payload.projectId), 'setActiveTab.projectId must be a string')
      assert(isNullableString(value.payload.tabId), 'setActiveTab.tabId must be a string or null')
      return value as ManagerRequest
    case 'closeTab':
      assert(isString(value.payload.projectId), 'closeTab.projectId must be a string')
      assert(isString(value.payload.tabId), 'closeTab.tabId must be a string')
      return value as ManagerRequest
    case 'disposeSession':
      assert(isString(value.payload.projectId), 'disposeSession.projectId must be a string')
      return value as ManagerRequest
    case 'ping':
      return value as ManagerRequest
    case 'setBroadcastEnabled':
      assert(
        typeof value.payload.enabled === 'boolean',
        'setBroadcastEnabled.enabled must be a boolean'
      )
      return value as ManagerRequest
    default:
      throw new IpcProtocolError(`Unknown IPC request type: ${String(value.type)}`)
  }
}

export function parseManagerMessage(value: unknown): ManagerResponse | ManagerEvent {
  assert(isObjectRecord(value), 'IPC message must be an object')
  assert(isString(value.type), 'IPC response type must be a string')
  assert(isObjectRecord(value.payload), 'IPC response payload must be an object')

  switch (value.type) {
    case 'helloResult':
      assert(isString(value.id), 'helloResult.id must be a string')
      assert(isHelloResult(value.payload), 'helloResult.payload is invalid')
      // Normalise wire-back-compat: pre-capability TMs omit the field.
      normaliseManagerCapabilities(value.payload)
      return value as ManagerResponse
    case 'ok':
      assert(isString(value.id), 'ok.id must be a string')
      return value as ManagerResponse
    case 'attachResult':
      assert(isString(value.id), 'attachResult.id must be a string')
      assert(isAttachResult(value.payload), 'attachResult.payload is invalid')
      return value as ManagerResponse
    case 'error':
      assert(isString(value.id), 'error.id must be a string')
      assert(isString(value.payload.message), 'error.message must be a string')
      return value as ManagerResponse
    case 'tabRender':
      assert(isString(value.payload.projectId), 'tabRender.projectId must be a string')
      assert(isString(value.payload.tabId), 'tabRender.tabId must be a string')
      assert(isTerminalSnapshot(value.payload.viewport), 'tabRender.viewport is invalid')
      assert(isTerminalModeState(value.payload.terminalModes), 'tabRender.terminalModes is invalid')
      return value as ManagerEvent
    case 'tabExit':
      assert(isString(value.payload.projectId), 'tabExit.projectId must be a string')
      assert(isString(value.payload.tabId), 'tabExit.tabId must be a string')
      assert(isFiniteNumber(value.payload.exitCode), 'tabExit.exitCode must be a number')
      return value as ManagerEvent
    case 'tabError':
      assert(isString(value.payload.projectId), 'tabError.projectId must be a string')
      assert(isString(value.payload.tabId), 'tabError.tabId must be a string')
      assert(isString(value.payload.message), 'tabError.message must be a string')
      return value as ManagerEvent
    default:
      throw new IpcProtocolError(`Unknown IPC response type: ${String(value.type)}`)
  }
}

export function encodeManagerMessage(message: ManagerMessage): Buffer {
  const payload = JSON.stringify(message)
  return Buffer.from(`${Buffer.byteLength(payload, 'utf8')}\n${payload}`, 'utf8')
}

export { MessageDecoder }
