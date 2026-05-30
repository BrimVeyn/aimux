import type {
  AIUsageProjection,
  AppStateProjection,
  GitFileEntryLite,
  GitModeLite,
  GitPaneLite,
  GitPanelLite,
  ModalProjection,
  ProjectedTab,
  SessionRecordLite,
  StatusBarProjection,
  WorktreeLite,
} from '@aimux/gui-protocol'
import type { ThemeMode } from '@brimveyn/aimux-config'

import type {
  AppState,
  GitFileEntry,
  GitModeState,
  GitPanelState,
  GitPaneState,
  ModalState,
  SessionRecord,
  TabSession,
  WorktreeRecord,
} from '../state/types'
import type { GuiHelpEntry } from './gui-help-entries'

import { encodeDiffImages } from './encode-diff-images'

export type { AIUsageProjection, AppStateProjection, ProjectedTab, StatusBarProjection }

function projectTab(tab: TabSession): ProjectedTab {
  return {
    activity: tab.activity,
    assistant: tab.assistant,
    command: tab.command,
    id: tab.id,
    status: tab.status,
    title: tab.title,
  }
}

function projectWorktree(w: WorktreeRecord): WorktreeLite {
  return {
    baseRef: w.baseRef,
    branch: w.branch,
    color: w.color,
    commitSha: w.commitSha,
    createdAt: w.createdAt,
    createdByAimux: w.createdByAimux,
    id: w.id,
    name: w.name,
    path: w.path,
    repoRoot: w.repoRoot,
    source: w.source,
    updatedAt: w.updatedAt,
  }
}

function projectSession(s: SessionRecord): SessionRecordLite {
  return {
    activeWorktreeId: s.activeWorktreeId,
    id: s.id,
    name: s.name,
    projectPath: s.projectPath,
    worktrees: s.worktrees?.map(projectWorktree),
  }
}

function projectGitFile(f: GitFileEntry): GitFileEntryLite {
  return {
    added: f.added ?? undefined,
    oldPath: f.renamedFrom,
    path: f.path,
    removed: f.removed ?? undefined,
    repoPath: f.repoPath,
    section: f.section,
    status: f.status,
  }
}

function projectGitPane(g: GitPaneState): GitPaneLite {
  return {
    diffCount: { enabled: g.diffCount.enabled },
    diffModeRatio: g.diffModeRatio,
    embeddedRatio: g.embeddedRatio,
    fileListMode: g.fileListMode,
    mode: g.mode,
    paneRatio: g.paneRatio,
    position: g.position,
    treeCompaction: g.treeCompaction,
    visible: g.visible,
  }
}

function projectGitPanel(g: GitPanelState): GitPanelLite {
  return {
    ahead: g.ahead,
    behind: g.behind,
    branch: g.branch,
    error: g.error,
    files: g.files.map(projectGitFile),
  }
}

function projectGitMode(g: GitModeState): GitModeLite {
  return {
    actionMessage: g.actionMessage,
    collapsedFolders: g.collapsedFolders,
    // Rewrite image byte fields to base64 strings so they survive JSON
    // serialization to the browser. See encode-diff-images.ts for the type
    // fudge details.
    diffs: Object.fromEntries(
      Object.entries(g.diffs).map(([k, d]) => [k, encodeDiffImages(d)])
    ) as Record<string, GitModeLite['diffs'][string]>,
    diffView: g.diffView,
    folds: g.folds,
    headOffset: g.headOffset,
    highlights: g.highlights,
    loading: g.loading,
    parsedFiles: g.parsedFiles,
    pendingDeletePath: g.pendingDeletePath,
    reviewBase: g.reviewBase,
    selectedEntryKey: g.selectedEntryKey,
  }
}

// ModalState is a discriminated union of ~14 variants; the wire ModalProjection
// is a flat optional bag (the renderer treats it loosely). Explicit-pick only
// the fields the renderer ever reads — anything else (cursorPos, branchError,
// pendingProjectPath, targetWorktreeIndex, entryCount, splitDirection,
// returnToSessionPicker, worktreeDelete*) stays host-internal.
function projectModal(modal: ModalState): ModalProjection {
  const m = modal as ModalState & Record<string, unknown>
  const out: ModalProjection = {
    editBuffer: modal.editBuffer,
    selectedIndex: modal.selectedIndex,
    type: modal.type,
  }
  if (typeof m.actionMessage === 'string' || m.actionMessage === null) {
    out.actionMessage = m.actionMessage as string | null
  }
  if (typeof m.activeField === 'string') {
    out.activeField = m.activeField as ModalProjection['activeField']
  }
  if (typeof m.branchName === 'string') out.branchName = m.branchName
  if (typeof m.createWorktree === 'boolean') out.createWorktree = m.createWorktree
  if (typeof m.deleteSource === 'boolean') out.deleteSource = m.deleteSource
  if (Array.isArray(m.directoryResults)) {
    out.directoryResults = m.directoryResults as ModalProjection['directoryResults']
  }
  if (typeof m.nameBuffer === 'string') out.nameBuffer = m.nameBuffer
  if (typeof m.scope === 'string' || m.scope === null) {
    out.scope = m.scope as string | null
  }
  if (typeof m.selectedAssistantId === 'string' || m.selectedAssistantId === null) {
    out.selectedAssistantId = m.selectedAssistantId as string | null
  }
  if (typeof m.sourceWorktreeId === 'string') out.sourceWorktreeId = m.sourceWorktreeId
  if (typeof m.step === 'string') out.step = m.step as ModalProjection['step']
  if (typeof m.worktreeName === 'string') out.worktreeName = m.worktreeName
  if (typeof m.contentBuffer === 'string' || m.contentBuffer === null) {
    out.contentBuffer = m.contentBuffer as string | null
  }
  if (typeof m.triggerBuffer === 'string' || m.triggerBuffer === null) {
    out.triggerBuffer = m.triggerBuffer as string | null
  }
  if (typeof m.stage === 'string') out.stage = m.stage as ModalProjection['stage']
  if (typeof m.sessionTargetId === 'string' || m.sessionTargetId === null) {
    out.sessionTargetId = m.sessionTargetId
  }
  if (typeof m.currentVersion === 'string') out.currentVersion = m.currentVersion
  if (typeof m.latestVersion === 'string') out.latestVersion = m.latestVersion
  return out
}

export function projectAppState(
  state: AppState,
  options: {
    aiUsage: AIUsageProjection
    committedThemeId: string
    helpEntries: GuiHelpEntry[]
    statusBar: StatusBarProjection
    themeId: string
    themeMode: ThemeMode
    transparent: boolean
  }
): AppStateProjection {
  return {
    activeTabId: state.activeTabId,
    aiUsage: options.aiUsage,
    committedThemeId: options.committedThemeId,
    currentSessionId: state.currentSessionId,
    customCommands: state.customCommands,
    focusMode: state.focusMode,
    gitMode: projectGitMode(state.gitMode),
    gitPane: projectGitPane(state.gitPane),
    gitPanel: projectGitPanel(state.gitPanel),
    helpEntries: options.helpEntries,
    layoutTrees: state.layoutTrees,
    modal: projectModal(state.modal),
    multiRepo: state.multiRepo,
    sessionBar: state.sessionBar,
    sessions: state.sessions.map(projectSession),
    sessionStatuses: state.sessionStatuses,
    sidebar: { visible: state.sidebar.visible, width: state.sidebar.width },
    snippets: state.snippets,
    statusBar: options.statusBar,
    tabGroupMap: state.tabGroupMap,
    tabs: state.tabs.map(projectTab),
    themeId: options.themeId,
    themeMode: options.themeMode,
    transparent: options.transparent,
    worktreeDivergence: state.worktreeDivergence,
  }
}
