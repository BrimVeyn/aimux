import type {
  ScrollIntent,
  TabSession,
  TerminalModeState,
  TerminalSnapshot,
  WorkspaceSnapshotV1,
} from '../state/types'

import { isWorkspaceSnapshotV1 } from '../state/validation'
import {
  getProcessVersion,
  IpcProtocolError,
  MessageDecoder,
  negotiateProtocolVersion,
} from './protocol'

export const MANAGER_PROTOCOL_MIN_VERSION = 2
export const MANAGER_PROTOCOL_VERSION = 2

export interface ManagerHelloRequest {
  minVersion: number
  maxVersion: number
}

export interface ManagerHelloResult {
  minVersion: number
  maxVersion: number
  processVersion: string
  selectedVersion: number
}

export interface ManagerAttachRequest {
  protocolVersion: number
  sessionId: string
  cols: number
  rows: number
  workspaceSnapshot?: WorkspaceSnapshotV1
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
        sessionId: string
        tabId: string
        assistant: TabSession['assistant']
        title: string
        command: string
        args?: string[]
        cols: number
        rows: number
        cwd?: string
      }
    }
  | { id: string; type: 'write'; payload: { sessionId: string; tabId: string; data: string } }
  | {
      id: string
      type: 'resizeClient'
      payload: {
        sessionId: string
        cols: number
        rows: number
        intents?: Record<string, ScrollIntent>
      }
    }
  | {
      id: string
      type: 'resizeTab'
      payload: {
        sessionId: string
        tabId: string
        cols: number
        rows: number
        intent?: ScrollIntent
      }
    }
  | {
      id: string
      type: 'scrollToBottom'
      payload: { sessionId: string; tabId: string }
    }
  | {
      id: string
      type: 'scroll'
      payload: { sessionId: string; tabId: string; deltaLines: number }
    }
  | {
      id: string
      type: 'reapplyScrollIntent'
      payload: { sessionId: string; tabId: string; intent: ScrollIntent }
    }
  | { id: string; type: 'setActiveTab'; payload: { sessionId: string; tabId: string | null } }
  | { id: string; type: 'closeTab'; payload: { sessionId: string; tabId: string } }
  | { id: string; type: 'disposeSession'; payload: { sessionId: string } }
  | { id: string; type: 'ping'; payload: Record<string, never> }

export type ManagerResponse =
  | { id: string; type: 'helloResult'; payload: ManagerHelloResult }
  | { id: string; type: 'ok'; payload: Record<string, never> }
  | { id: string; type: 'attachResult'; payload: ManagerAttachResult }
  | { id: string; type: 'error'; payload: { message: string } }

export type ManagerEvent =
  | {
      type: 'tabRender'
      payload: {
        sessionId: string
        tabId: string
        viewport: TerminalSnapshot
        terminalModes: TerminalModeState
      }
    }
  | { type: 'tabExit'; payload: { sessionId: string; tabId: string; exitCode: number } }
  | { type: 'tabError'; payload: { sessionId: string; tabId: string; message: string } }

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

function isTerminalSpan(value: unknown): boolean {
  return (
    isObjectRecord(value) &&
    isString(value.text) &&
    (value.fg === undefined || isString(value.fg)) &&
    (value.bg === undefined || isString(value.bg)) &&
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
    typeof value.cursorVisible === 'boolean'
  )
}

function isScrollIntent(value: unknown): value is ScrollIntent {
  if (!isObjectRecord(value)) return false
  if (value.kind === 'bottom') return true
  if (value.kind === 'anchor') return isFiniteNumber(value.absoluteLine)
  return false
}

function isScrollIntentRecord(value: unknown): value is Record<string, ScrollIntent> {
  if (!isObjectRecord(value)) return false
  return Object.values(value).every(isScrollIntent)
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
    isString(value.processVersion)
  )
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new IpcProtocolError(message)
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
      assert(isString(value.payload.sessionId), 'attachSession.sessionId must be a string')
      assert(isFiniteNumber(value.payload.cols), 'attachSession.cols must be a number')
      assert(isFiniteNumber(value.payload.rows), 'attachSession.rows must be a number')
      assert(
        value.payload.workspaceSnapshot === undefined ||
          isWorkspaceSnapshotV1(value.payload.workspaceSnapshot),
        'attachSession.workspaceSnapshot must be a valid workspace snapshot'
      )
      return value as ManagerRequest
    case 'createTab':
      assert(isString(value.payload.sessionId), 'createTab.sessionId must be a string')
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
      return value as ManagerRequest
    case 'write':
      assert(isString(value.payload.sessionId), 'write.sessionId must be a string')
      assert(isString(value.payload.tabId), 'write.tabId must be a string')
      assert(isString(value.payload.data), 'write.data must be a string')
      return value as ManagerRequest
    case 'resizeClient':
      assert(isString(value.payload.sessionId), 'resizeClient.sessionId must be a string')
      assert(isFiniteNumber(value.payload.cols), 'resizeClient.cols must be a number')
      assert(isFiniteNumber(value.payload.rows), 'resizeClient.rows must be a number')
      assert(
        value.payload.intents === undefined || isScrollIntentRecord(value.payload.intents),
        'resizeClient.intents must be a scroll-intent record'
      )
      return value as ManagerRequest
    case 'resizeTab':
      assert(isString(value.payload.sessionId), 'resizeTab.sessionId must be a string')
      assert(isString(value.payload.tabId), 'resizeTab.tabId must be a string')
      assert(isFiniteNumber(value.payload.cols), 'resizeTab.cols must be a number')
      assert(isFiniteNumber(value.payload.rows), 'resizeTab.rows must be a number')
      assert(
        value.payload.intent === undefined || isScrollIntent(value.payload.intent),
        'resizeTab.intent must be a scroll intent'
      )
      return value as ManagerRequest
    case 'scroll':
      assert(isString(value.payload.sessionId), 'scroll.sessionId must be a string')
      assert(isString(value.payload.tabId), 'scroll.tabId must be a string')
      assert(isFiniteNumber(value.payload.deltaLines), 'scroll.deltaLines must be a number')
      return value as ManagerRequest
    case 'scrollToBottom':
      assert(isString(value.payload.sessionId), 'scrollToBottom.sessionId must be a string')
      assert(isString(value.payload.tabId), 'scrollToBottom.tabId must be a string')
      return value as ManagerRequest
    case 'reapplyScrollIntent':
      assert(isString(value.payload.sessionId), 'reapplyScrollIntent.sessionId must be a string')
      assert(isString(value.payload.tabId), 'reapplyScrollIntent.tabId must be a string')
      assert(
        isScrollIntent(value.payload.intent),
        'reapplyScrollIntent.intent must be a scroll intent'
      )
      return value as ManagerRequest
    case 'setActiveTab':
      assert(isString(value.payload.sessionId), 'setActiveTab.sessionId must be a string')
      assert(isNullableString(value.payload.tabId), 'setActiveTab.tabId must be a string or null')
      return value as ManagerRequest
    case 'closeTab':
      assert(isString(value.payload.sessionId), 'closeTab.sessionId must be a string')
      assert(isString(value.payload.tabId), 'closeTab.tabId must be a string')
      return value as ManagerRequest
    case 'disposeSession':
      assert(isString(value.payload.sessionId), 'disposeSession.sessionId must be a string')
      return value as ManagerRequest
    case 'ping':
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
      assert(isString(value.payload.sessionId), 'tabRender.sessionId must be a string')
      assert(isString(value.payload.tabId), 'tabRender.tabId must be a string')
      assert(isTerminalSnapshot(value.payload.viewport), 'tabRender.viewport is invalid')
      assert(isTerminalModeState(value.payload.terminalModes), 'tabRender.terminalModes is invalid')
      return value as ManagerEvent
    case 'tabExit':
      assert(isString(value.payload.sessionId), 'tabExit.sessionId must be a string')
      assert(isString(value.payload.tabId), 'tabExit.tabId must be a string')
      assert(isFiniteNumber(value.payload.exitCode), 'tabExit.exitCode must be a number')
      return value as ManagerEvent
    case 'tabError':
      assert(isString(value.payload.sessionId), 'tabError.sessionId must be a string')
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
