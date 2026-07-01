import type {
  AssistantId,
  SessionStatus,
  TabActivity,
  TabSession,
  TabStatus,
  TerminalModeState,
  TerminalSnapshot,
  WorkspaceSnapshotV1,
} from '../state/types'

import { isWorkspaceSnapshotV1 } from '../state/validation'

// v9: scroll position is owned entirely by the backend emulator. Dropped the
// per-tab scroll `intent`/`intents` from resize messages and removed the
// `reapplyScrollIntent` message — the frontend no longer derives or sends it.
// (v8 was the unfilled-viewport status-detector change; this is a further
// breaking wire change, so the version steps again.)
//
// v11: additive — exposes `listTabs` (read-only enumeration without `attach`),
// `attach.thin` (skip server-side resize so a headless CLI can attach
// alongside a UI without resizing PTYs), and `createTab` cols/rows=0 fallback
// to the session's last attached size. All three are gated behind
// capabilities; MIN stays at 10 so a v10 UI keeps talking to a v11 daemon
// (and vice-versa).
export const IPC_PROTOCOL_MIN_VERSION = 10
export const IPC_PROTOCOL_VERSION = 11

/**
 * Capability advertised by a daemon that knows how to drain + handoff its
 * socket to a freshly-spawned successor binary instead of dying outright.
 * Clients only attempt `prepareReexec` against a daemon that advertises
 * this — older daemons would respond with an unknown-request error.
 */
export const IPC_CAPABILITY_HOT_REEXEC = 'hotReexec'

/**
 * Capability gating the `listTabs` request. CLI clients check for it before
 * issuing the request; pre-v11 daemons would respond with `unknown request`.
 */
export const IPC_CAPABILITY_LIST_TABS = 'listTabs'

/**
 * Capability gating the `attach.thin` flag. When advertised, the daemon will
 * skip the implicit `manager.resize` on attach so a headless CLI can attach
 * to read state without clobbering the UI's dimensions on shared PTYs.
 */
export const IPC_CAPABILITY_THIN_ATTACH = 'thinAttach'

/**
 * Capability gating `createTab` with `cols: 0` or `rows: 0` meaning "use the
 * session's last attached size". Older daemons would propagate 0 straight to
 * the TM and spawn a zero-sized PTY, so the client only sends zeroes when
 * this capability is advertised.
 */
export const IPC_CAPABILITY_CREATE_TAB_SIZE_FALLBACK = 'createTabSizeFallback'

/**
 * Capability gating the `tabAdded` server event. When advertised, the daemon
 * fans a `tabAdded` event out to every socket attached to the session after
 * a successful `createTab` — that's how a UI process learns about tabs
 * created by a sibling CLI invocation. Pre-cap UIs simply never see the
 * event and continue to discover tabs only via the next `attachResult`.
 */
export const IPC_CAPABILITY_TAB_LIFECYCLE_EVENTS = 'tabLifecycleEvents'

/**
 * Capability gating the optional `worktreeId` on `createTab` payloads. With
 * it, the CLI can spawn a tab inside a specific worktree of the active
 * session so the UI groups it correctly. Older daemons ignore the field
 * (the parser accepts it but the TM has no knob for it pre-bump).
 */
export const IPC_CAPABILITY_CREATE_TAB_WORKTREE_ID = 'createTabWorktreeId'

/**
 * Capabilities advertised by *this* process in its `helloResult`. Additive
 * features should be introduced as new capability strings here rather than
 * via a MIN bump. See `src/ipc/README.md` for the discipline.
 *
 * Capabilities are namespaced informally per-protocol (camelCase in this
 * file). Legacy peers that predate the field omit it entirely; the parser
 * normalises a missing field to `[]`, so consumers can safely call
 * `.includes(...)` on it.
 */
export const IPC_PROTOCOL_CAPABILITIES: readonly string[] = [
  IPC_CAPABILITY_HOT_REEXEC,
  IPC_CAPABILITY_LIST_TABS,
  IPC_CAPABILITY_THIN_ATTACH,
  IPC_CAPABILITY_CREATE_TAB_SIZE_FALLBACK,
  IPC_CAPABILITY_TAB_LIFECYCLE_EVENTS,
  IPC_CAPABILITY_CREATE_TAB_WORKTREE_ID,
]

export interface ProtocolHelloRequest {
  minVersion: number
  maxVersion: number
}

export interface ProtocolHelloResult {
  minVersion: number
  maxVersion: number
  processVersion: string
  selectedVersion: number
  /**
   * Feature flags. Always present on the typed shape; older peers that did
   * not yet advertise capabilities are normalised to `[]` at parse time.
   */
  capabilities: string[]
  /**
   * Manager-protocol version currently negotiated between the daemon and
   * its terminal-manager. `undefined` when the daemon has not yet connected
   * (or when the peer predates the field). Bootstrap uses this to decide
   * whether a hot-reexec attempt has any chance: if the caller's
   * MANAGER_PROTOCOL_MIN_VERSION > this, the successor daemon would fail
   * to speak to the existing TM and the reexec is doomed.
   */
  managerSelectedVersion?: number
}

export interface AttachRequest {
  protocolVersion: number
  sessionId: string
  cols: number
  rows: number
  workspaceSnapshot?: WorkspaceSnapshotV1
  /**
   * v11 / capability `thinAttach`. When true, the daemon does not call
   * `manager.resize` on the session — the headless attacher (CLI) does not
   * own a viewport, so it must not clobber the dimensions a UI process is
   * driving for the same session.
   *
   * Pre-v11 daemons ignore the field; the gate exists so the client knows
   * to fall through to a full attach (with a sentinel size) when the daemon
   * predates the flag.
   */
  thin?: boolean
}

/**
 * Slim per-tab summary returned by `listTabs`. Subset of {@link TabSession}
 * with the buffer/viewport/terminalModes intentionally omitted so the request
 * stays cheap even on sessions with many tabs.
 */
export interface TabSessionSummary {
  id: string
  assistant: AssistantId
  title: string
  status: TabStatus
  activity?: TabActivity
  command: string
  worktreeId?: string
}

export interface ListTabsResult {
  tabs: TabSessionSummary[]
  activeTabId: string | null
}

export interface AttachResult {
  protocolVersion: number
  tabs: TabSession[]
  activeTabId: string | null
  /**
   * Snapshot of every known session's status at attach time. Applied by
   * the client atomically with `hydrate-workspace` so chips render the
   * right state immediately, without the per-event race where a separate
   * `sessionStatus` event could arrive before the session was in state.
   */
  initialSessionStatuses: { sessionId: string; status: SessionStatus }[]
}

export type ClientRequest =
  | { id: string; type: 'hello'; payload: ProtocolHelloRequest }
  | { id: string; type: 'attach'; payload: AttachRequest }
  | {
      id: string
      type: 'createTab'
      payload: {
        tabId: string
        assistant: TabSession['assistant']
        title: string
        command: string
        args?: string[]
        cols: number
        rows: number
        cwd?: string
        /**
         * v11 / capability `createTabWorktreeId`. Lets the CLI spawn a tab
         * inside a specific worktree so the UI groups it correctly. The
         * field is parsed unconditionally — older daemons accepted no such
         * field, so this is a true additive on the wire — but the daemon
         * only forwards it to the TM when its own capability is in play.
         */
        worktreeId?: string
      }
    }
  | { id: string; type: 'write'; payload: { tabId: string; data: string } }
  | {
      id: string
      type: 'resizeClient'
      payload: { cols: number; rows: number }
    }
  | {
      id: string
      type: 'resizeTab'
      payload: { tabId: string; cols: number; rows: number }
    }
  | { id: string; type: 'scrollToBottom'; payload: { tabId: string } }
  | { id: string; type: 'scroll'; payload: { tabId: string; deltaLines: number } }
  | { id: string; type: 'setActiveTab'; payload: { tabId: string | null } }
  | { id: string; type: 'closeTab'; payload: { tabId: string } }
  | { id: string; type: 'disposeAll'; payload: Record<string, never> }
  | { id: string; type: 'ping'; payload: Record<string, never> }
  // Capability-gated on `hotReexec`. The daemon drains, writes a handoff
  // file, renames its socket out of the way, and exits cleanly so a freshly
  // spawned successor binary can bind the canonical socket path while the
  // terminal-manager (and every PTY) keeps running.
  | { id: string; type: 'prepareReexec'; payload: { reason?: string } }
  // Capability-gated on `listTabs`. Read-only enumeration of a session's
  // tabs — does NOT attach. Lets a headless CLI inspect a session without
  // implicit `manager.resize` or `setBroadcastEnabled` side effects.
  | { id: string; type: 'listTabs'; payload: { sessionId: string } }

export type ServerResponse =
  | { id: string; type: 'helloResult'; payload: ProtocolHelloResult }
  | { id: string; type: 'ok'; payload: Record<string, never> }
  | { id: string; type: 'attachResult'; payload: AttachResult }
  | { id: string; type: 'listTabsResult'; payload: ListTabsResult }
  | { id: string; type: 'error'; payload: { message: string } }
  | {
      id: string
      type: 'reexecAck'
      payload: {
        /** Absolute path to the handoff file the successor should consume. */
        handoffPath: string
        /** Where the old daemon renamed its still-bound socket. Provided for
         * diagnostics — the canonical socket path is now free. */
        renamedSocketPath: string
      }
    }

export type ServerEvent =
  | {
      type: 'tabRender'
      payload: { tabId: string; viewport: TerminalSnapshot; terminalModes: TerminalModeState }
    }
  | { type: 'tabExit'; payload: { tabId: string; exitCode: number } }
  | { type: 'tabError'; payload: { tabId: string; message: string } }
  | { type: 'tabStatus'; payload: { sessionId: string; tabId: string; status: TabActivity } }
  | { type: 'sessionStatus'; payload: { sessionId: string; status: SessionStatus } }
  // Capability-gated on `tabLifecycleEvents`. Broadcast after a successful
  // `createTab` so every UI/CLI client attached to the same session learns
  // about the new tab without having to re-attach. The tab's `viewport` is
  // intentionally omitted — the very next `tabRender` event carries it.
  | {
      type: 'tabAdded'
      payload: { sessionId: string; tab: TabSession }
    }

export type IpcMessage = ClientRequest | ServerResponse | ServerEvent

export class IpcProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IpcProtocolError'
  }
}

export class ProtocolMismatchError extends Error {
  constructor(
    public readonly clientVersion: number,
    public readonly daemonVersion: number
  ) {
    super(`Protocol mismatch: client v${clientVersion}, daemon v${daemonVersion}`)
    this.name = 'ProtocolMismatchError'
  }
}

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

function isTabActivity(value: unknown): value is TabActivity {
  return value === 'working' || value === 'waiting-input' || value === 'idle'
}

function isSessionStatus(value: unknown): value is SessionStatus {
  return (
    isObjectRecord(value) &&
    typeof value.working === 'boolean' &&
    typeof value.waiting === 'boolean'
  )
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

function isProtocolHelloResult(value: unknown): value is ProtocolHelloResult {
  return (
    isObjectRecord(value) &&
    isFiniteNumber(value.minVersion) &&
    isFiniteNumber(value.maxVersion) &&
    isFiniteNumber(value.selectedVersion) &&
    isString(value.processVersion) &&
    // Wire-back-compat: peers that predate the capabilities field omit it
    // entirely. parseServerMessage normalises that to `[]` before the cast
    // so the typed shape stays non-optional.
    (value.capabilities === undefined || isStringArray(value.capabilities)) &&
    // Additive: peers that predate managerSelectedVersion omit it.
    (value.managerSelectedVersion === undefined || isFiniteNumber(value.managerSelectedVersion))
  )
}

function isTabSessionSummary(value: unknown): value is TabSessionSummary {
  return (
    isObjectRecord(value) &&
    isString(value.id) &&
    isString(value.assistant) &&
    value.assistant.length > 0 &&
    isString(value.title) &&
    (value.status === 'starting' ||
      value.status === 'running' ||
      value.status === 'disconnected' ||
      value.status === 'error') &&
    (value.activity === undefined ||
      value.activity === 'working' ||
      value.activity === 'waiting-input' ||
      value.activity === 'idle') &&
    isString(value.command) &&
    (value.worktreeId === undefined || isString(value.worktreeId))
  )
}

function isListTabsResult(value: unknown): value is ListTabsResult {
  return (
    isObjectRecord(value) &&
    Array.isArray(value.tabs) &&
    value.tabs.every(isTabSessionSummary) &&
    isNullableString(value.activeTabId)
  )
}

function isTabSession(value: unknown): value is TabSession {
  return (
    isObjectRecord(value) &&
    isString(value.id) &&
    isString(value.assistant) &&
    value.assistant.length > 0 &&
    isString(value.title) &&
    (value.status === 'starting' ||
      value.status === 'running' ||
      value.status === 'disconnected' ||
      value.status === 'error') &&
    (value.activity === undefined ||
      value.activity === 'working' ||
      value.activity === 'waiting-input' ||
      value.activity === 'idle') &&
    isString(value.buffer) &&
    isTerminalModeState(value.terminalModes) &&
    isString(value.command) &&
    (value.viewport === undefined || isTerminalSnapshot(value.viewport)) &&
    (value.errorMessage === undefined || isString(value.errorMessage)) &&
    (value.exitCode === undefined || isFiniteNumber(value.exitCode)) &&
    (value.worktreeId === undefined || isString(value.worktreeId))
  )
}

function isAttachResult(value: unknown): value is AttachResult {
  return (
    isObjectRecord(value) &&
    isFiniteNumber(value.protocolVersion) &&
    Array.isArray(value.tabs) &&
    value.tabs.every(isTabSession) &&
    isNullableString(value.activeTabId) &&
    Array.isArray(value.initialSessionStatuses) &&
    value.initialSessionStatuses.every(
      (entry) => isObjectRecord(entry) && isString(entry.sessionId) && isSessionStatus(entry.status)
    )
  )
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new IpcProtocolError(message)
  }
}

function normaliseCapabilities(payload: Record<string, unknown>): void {
  if (!Array.isArray(payload.capabilities)) {
    payload.capabilities = []
  }
}

export function negotiateProtocolVersion(
  clientMinVersion: number,
  clientMaxVersion: number,
  serverMinVersion: number,
  serverMaxVersion: number
): number | null {
  const minVersion = Math.max(clientMinVersion, serverMinVersion)
  const maxVersion = Math.min(clientMaxVersion, serverMaxVersion)
  if (minVersion > maxVersion) {
    return null
  }

  return maxVersion
}

export function getProcessVersion(): string {
  return Bun.version
}

export function parseClientRequest(value: unknown): ClientRequest {
  assert(isObjectRecord(value), 'IPC message must be an object')
  assert(isString(value.id), 'IPC request id must be a string')
  assert(isString(value.type), 'IPC request type must be a string')
  assert(isObjectRecord(value.payload), 'IPC request payload must be an object')

  switch (value.type) {
    case 'hello':
      assert(isFiniteNumber(value.payload.minVersion), 'hello.minVersion must be a number')
      assert(isFiniteNumber(value.payload.maxVersion), 'hello.maxVersion must be a number')
      return value as ClientRequest
    case 'attach':
      assert(
        isFiniteNumber(value.payload.protocolVersion),
        'attach.protocolVersion must be a number'
      )
      assert(isString(value.payload.sessionId), 'attach.sessionId must be a string')
      assert(isFiniteNumber(value.payload.cols), 'attach.cols must be a number')
      assert(isFiniteNumber(value.payload.rows), 'attach.rows must be a number')
      assert(
        value.payload.workspaceSnapshot === undefined ||
          isWorkspaceSnapshotV1(value.payload.workspaceSnapshot),
        'attach.workspaceSnapshot must be a valid workspace snapshot'
      )
      assert(
        value.payload.thin === undefined || typeof value.payload.thin === 'boolean',
        'attach.thin must be a boolean when present'
      )
      return value as ClientRequest
    case 'listTabs':
      assert(isString(value.payload.sessionId), 'listTabs.sessionId must be a string')
      return value as ClientRequest
    case 'createTab':
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
        value.payload.worktreeId === undefined || isString(value.payload.worktreeId),
        'createTab.worktreeId must be a string when present'
      )
      return value as ClientRequest
    case 'write':
      assert(isString(value.payload.tabId), 'write.tabId must be a string')
      assert(isString(value.payload.data), 'write.data must be a string')
      return value as ClientRequest
    case 'resizeClient':
      assert(isFiniteNumber(value.payload.cols), 'resizeClient.cols must be a number')
      assert(isFiniteNumber(value.payload.rows), 'resizeClient.rows must be a number')
      return value as ClientRequest
    case 'resizeTab':
      assert(isString(value.payload.tabId), 'resizeTab.tabId must be a string')
      assert(isFiniteNumber(value.payload.cols), 'resizeTab.cols must be a number')
      assert(isFiniteNumber(value.payload.rows), 'resizeTab.rows must be a number')
      return value as ClientRequest
    case 'scroll':
      assert(isString(value.payload.tabId), 'scroll.tabId must be a string')
      assert(isFiniteNumber(value.payload.deltaLines), 'scroll.deltaLines must be a number')
      return value as ClientRequest
    case 'scrollToBottom':
      assert(isString(value.payload.tabId), 'scrollToBottom.tabId must be a string')
      return value as ClientRequest
    case 'setActiveTab':
      assert(isNullableString(value.payload.tabId), 'setActiveTab.tabId must be a string or null')
      return value as ClientRequest
    case 'closeTab':
      assert(isString(value.payload.tabId), 'closeTab.tabId must be a string')
      return value as ClientRequest
    case 'disposeAll':
    case 'ping':
      return value as ClientRequest
    case 'prepareReexec':
      assert(
        value.payload.reason === undefined || isString(value.payload.reason),
        'prepareReexec.reason must be a string when present'
      )
      return value as ClientRequest
    default:
      throw new IpcProtocolError(`Unknown IPC request type: ${String(value.type)}`)
  }
}

export function parseServerMessage(value: unknown): ServerResponse | ServerEvent {
  assert(isObjectRecord(value), 'IPC message must be an object')
  assert(isString(value.type), 'IPC response type must be a string')
  assert(isObjectRecord(value.payload), 'IPC response payload must be an object')

  switch (value.type) {
    case 'helloResult':
      assert(isString(value.id), 'helloResult.id must be a string')
      assert(isProtocolHelloResult(value.payload), 'helloResult.payload is invalid')
      // Normalise wire-back-compat: older daemons omit `capabilities`. Force
      // the field to `[]` so the typed shape ProtocolHelloResult.capabilities
      // is always a real array — callers can `.includes(...)` without a guard.
      normaliseCapabilities(value.payload)
      return value as ServerResponse
    case 'ok':
      assert(isString(value.id), 'ok.id must be a string')
      return value as ServerResponse
    case 'attachResult':
      assert(isString(value.id), 'attachResult.id must be a string')
      assert(isAttachResult(value.payload), 'attachResult.payload is invalid')
      return value as ServerResponse
    case 'listTabsResult':
      assert(isString(value.id), 'listTabsResult.id must be a string')
      assert(isListTabsResult(value.payload), 'listTabsResult.payload is invalid')
      return value as ServerResponse
    case 'error':
      assert(isString(value.id), 'error.id must be a string')
      assert(isString(value.payload.message), 'error.message must be a string')
      return value as ServerResponse
    case 'reexecAck':
      assert(isString(value.id), 'reexecAck.id must be a string')
      assert(isString(value.payload.handoffPath), 'reexecAck.handoffPath must be a string')
      assert(
        isString(value.payload.renamedSocketPath),
        'reexecAck.renamedSocketPath must be a string'
      )
      return value as ServerResponse
    case 'tabRender':
      assert(isString(value.payload.tabId), 'tabRender.tabId must be a string')
      assert(isTerminalSnapshot(value.payload.viewport), 'tabRender.viewport is invalid')
      assert(isTerminalModeState(value.payload.terminalModes), 'tabRender.terminalModes is invalid')
      return value as ServerEvent
    case 'tabExit':
      assert(isString(value.payload.tabId), 'tabExit.tabId must be a string')
      assert(isFiniteNumber(value.payload.exitCode), 'tabExit.exitCode must be a number')
      return value as ServerEvent
    case 'tabError':
      assert(isString(value.payload.tabId), 'tabError.tabId must be a string')
      assert(isString(value.payload.message), 'tabError.message must be a string')
      return value as ServerEvent
    case 'tabStatus':
      assert(isString(value.payload.sessionId), 'tabStatus.sessionId must be a string')
      assert(isString(value.payload.tabId), 'tabStatus.tabId must be a string')
      assert(isTabActivity(value.payload.status), 'tabStatus.status is invalid')
      return value as ServerEvent
    case 'tabAdded':
      assert(isString(value.payload.sessionId), 'tabAdded.sessionId must be a string')
      assert(isTabSession(value.payload.tab), 'tabAdded.tab is invalid')
      return value as ServerEvent
    case 'sessionStatus':
      assert(isString(value.payload.sessionId), 'sessionStatus.sessionId must be a string')
      assert(isSessionStatus(value.payload.status), 'sessionStatus.status is invalid')
      return value as ServerEvent
    default:
      throw new IpcProtocolError(`Unknown IPC response type: ${String(value.type)}`)
  }
}

export function encodeMessage(message: IpcMessage): Buffer {
  const payload = JSON.stringify(message)
  return Buffer.from(`${Buffer.byteLength(payload, 'utf8')}\n${payload}`, 'utf8')
}

export class MessageDecoder<TMessage = IpcMessage> {
  private buffer = Buffer.alloc(0)
  private expectedPayloadBytes: number | null = null

  constructor(
    private readonly parseMessage: (value: unknown) => TMessage = (value) => value as TMessage
  ) {}

  push(chunk: string | Uint8Array): TMessage[] {
    const nextChunk = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk)
    this.buffer = this.buffer.length === 0 ? nextChunk : Buffer.concat([this.buffer, nextChunk])

    const messages: TMessage[] = []
    while (true) {
      if (this.expectedPayloadBytes === null) {
        const separatorIndex = this.buffer.indexOf(0x0a)
        if (separatorIndex === -1) {
          break
        }

        const header = this.buffer.subarray(0, separatorIndex).toString('utf8')
        if (!/^\d+$/.test(header)) {
          throw new Error(`Invalid IPC frame header: ${JSON.stringify(header)}`)
        }

        this.expectedPayloadBytes = Number.parseInt(header, 10)
        this.buffer = this.buffer.subarray(separatorIndex + 1)
      }

      if (this.buffer.length < this.expectedPayloadBytes) {
        break
      }

      const payload = this.buffer.subarray(0, this.expectedPayloadBytes).toString('utf8')
      this.buffer = this.buffer.subarray(this.expectedPayloadBytes)
      this.expectedPayloadBytes = null
      messages.push(this.parseMessage(JSON.parse(payload)))
    }

    return messages
  }

  reset(): void {
    this.buffer = Buffer.alloc(0)
    this.expectedPayloadBytes = null
  }
}
