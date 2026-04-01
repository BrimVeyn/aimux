import type {
  SessionRecord,
  SnippetRecord,
  TerminalLine,
  TerminalModeState,
  TerminalSnapshot,
  WorkspaceSnapshotV1,
} from './types'

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isTerminalLine(value: unknown): value is TerminalLine {
  if (!isObjectRecord(value) || !Array.isArray(value.spans)) {
    return false
  }

  return value.spans.every((span) => {
    if (!isObjectRecord(span) || !isString(span.text)) {
      return false
    }

    return (
      (span.fg === undefined || isString(span.fg)) &&
      (span.bg === undefined || isString(span.bg)) &&
      (span.bold === undefined || isBoolean(span.bold)) &&
      (span.italic === undefined || isBoolean(span.italic)) &&
      (span.underline === undefined || isBoolean(span.underline)) &&
      (span.cursor === undefined || isBoolean(span.cursor))
    )
  })
}

function isTerminalSnapshot(value: unknown): value is TerminalSnapshot {
  return (
    isObjectRecord(value) &&
    Array.isArray(value.lines) &&
    value.lines.every(isTerminalLine) &&
    isFiniteNumber(value.viewportY) &&
    isFiniteNumber(value.baseY) &&
    isBoolean(value.cursorVisible)
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
    isBoolean(value.sendFocusMode) &&
    isBoolean(value.alternateScrollMode) &&
    isBoolean(value.isAlternateBuffer) &&
    isBoolean(value.bracketedPasteMode)
  )
}

export function isWorkspaceSnapshotV1(value: unknown): value is WorkspaceSnapshotV1 {
  return (
    isObjectRecord(value) &&
    value.version === 1 &&
    isString(value.savedAt) &&
    (value.activeTabId === null || isString(value.activeTabId)) &&
    isObjectRecord(value.sidebar) &&
    isBoolean(value.sidebar.visible) &&
    isFiniteNumber(value.sidebar.width) &&
    Array.isArray(value.tabs) &&
    value.tabs.every(
      (tab) =>
        isObjectRecord(tab) &&
        isString(tab.id) &&
        isString(tab.assistant) &&
        tab.assistant.length > 0 &&
        isString(tab.title) &&
        isString(tab.command) &&
        (tab.status === 'starting' ||
          tab.status === 'running' ||
          tab.status === 'exited' ||
          tab.status === 'error') &&
        isString(tab.buffer) &&
        isTerminalModeState(tab.terminalModes) &&
        (tab.viewport === undefined || isTerminalSnapshot(tab.viewport)) &&
        (tab.errorMessage === undefined || isString(tab.errorMessage)) &&
        (tab.exitCode === undefined || isFiniteNumber(tab.exitCode))
    )
  )
}

export function isSessionRecord(value: unknown): value is SessionRecord {
  return (
    isObjectRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    (value.projectPath === undefined || isString(value.projectPath)) &&
    isString(value.createdAt) &&
    isString(value.updatedAt) &&
    isString(value.lastOpenedAt) &&
    (value.workspaceSnapshot === undefined || isWorkspaceSnapshotV1(value.workspaceSnapshot))
  )
}

export function isSnippetRecord(value: unknown): value is SnippetRecord {
  return (
    isObjectRecord(value) && isString(value.id) && isString(value.name) && isString(value.content)
  )
}
