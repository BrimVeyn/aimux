import type {
  ProjectRecord,
  ProjectSnapshotV1,
  SnippetRecord,
  TerminalLine,
  TerminalModeState,
  TerminalSnapshot,
  WorkspaceRecord,
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

function isTerminalCursorStyle(value: unknown): boolean {
  return value === 'block' || value === 'underline' || value === 'bar' || value === 'default'
}

function isTerminalSnapshot(value: unknown): value is TerminalSnapshot {
  return (
    isObjectRecord(value) &&
    Array.isArray(value.lines) &&
    value.lines.every(isTerminalLine) &&
    isFiniteNumber(value.viewportY) &&
    isFiniteNumber(value.baseY) &&
    isBoolean(value.cursorVisible) &&
    (value.cursorStyle === undefined || isTerminalCursorStyle(value.cursorStyle)) &&
    (value.cursorBlink === undefined || isBoolean(value.cursorBlink)) &&
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
    isBoolean(value.sendFocusMode) &&
    isBoolean(value.alternateScrollMode) &&
    isBoolean(value.isAlternateBuffer) &&
    isBoolean(value.bracketedPasteMode)
  )
}

function isLayoutNode(value: unknown): boolean {
  if (!isObjectRecord(value)) return false
  if (value.type === 'leaf') {
    return isString(value.tabId) && value.tabId.length > 0
  }
  if (value.type === 'split') {
    return (
      (value.direction === 'horizontal' || value.direction === 'vertical') &&
      isFiniteNumber(value.ratio) &&
      value.ratio > 0 &&
      value.ratio < 1 &&
      isLayoutNode(value.first) &&
      isLayoutNode(value.second)
    )
  }
  return false
}

function isLayoutTreesMap(value: unknown): boolean {
  if (!isObjectRecord(value)) return false
  return Object.values(value).every(isLayoutNode)
}

function isStringRecord(value: unknown): boolean {
  if (!isObjectRecord(value)) return false
  return Object.values(value).every(isString)
}

export function isWorkspaceRecord(value: unknown): value is WorkspaceRecord {
  return (
    isObjectRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isString(value.path) &&
    isString(value.repoRoot) &&
    (value.branch === undefined || isString(value.branch)) &&
    (value.baseRef === undefined || isString(value.baseRef)) &&
    (value.commitSha === undefined || isString(value.commitSha)) &&
    (value.source === 'primary' || value.source === 'aimux-temp' || value.source === 'external') &&
    isBoolean(value.createdByAimux) &&
    (value.color === undefined || isString(value.color)) &&
    isString(value.createdAt) &&
    isString(value.updatedAt)
  )
}

export function isProjectSnapshotV1(value: unknown): value is ProjectSnapshotV1 {
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
        (tab.exitCode === undefined || isFiniteNumber(tab.exitCode)) &&
        (tab.workspaceId === undefined || isString(tab.workspaceId)) &&
        (tab.workerName === undefined || isString(tab.workerName)) &&
        (tab.autoRenameStatus === undefined ||
          tab.autoRenameStatus === 'eligible' ||
          tab.autoRenameStatus === 'attempted')
    ) &&
    (value.layoutTree === undefined || isLayoutNode(value.layoutTree)) &&
    (value.layoutTrees === undefined || isLayoutTreesMap(value.layoutTrees)) &&
    (value.tabGroupMap === undefined || isStringRecord(value.tabGroupMap))
  )
}

export function isProjectRecord(value: unknown): value is ProjectRecord {
  return (
    isObjectRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    (value.projectPath === undefined || isString(value.projectPath)) &&
    isString(value.createdAt) &&
    isString(value.updatedAt) &&
    isString(value.lastOpenedAt) &&
    (value.order === undefined ||
      (typeof value.order === 'number' && Number.isFinite(value.order))) &&
    (value.projectSnapshot === undefined || isProjectSnapshotV1(value.projectSnapshot)) &&
    (value.workspaces === undefined ||
      (Array.isArray(value.workspaces) && value.workspaces.every(isWorkspaceRecord))) &&
    (value.activeWorkspaceId === undefined || isString(value.activeWorkspaceId))
  )
}

function isSnippetVar(value: unknown): boolean {
  if (!isObjectRecord(value)) return false
  if (!isString(value.sh)) return false
  if (value.timeout !== undefined && !isFiniteNumber(value.timeout)) return false
  if (value.trim !== undefined && !isBoolean(value.trim)) return false
  return true
}

function isSnippetVarRecord(value: unknown): boolean {
  if (!isObjectRecord(value)) return false
  for (const entry of Object.values(value)) {
    if (!isSnippetVar(entry)) return false
  }
  return true
}

export function isSnippetRecord(value: unknown): value is SnippetRecord {
  return (
    isObjectRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isString(value.content) &&
    (value.trigger === undefined || isString(value.trigger)) &&
    (value.vars === undefined || isSnippetVarRecord(value.vars))
  )
}
