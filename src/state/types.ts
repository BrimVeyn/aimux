// The application state shapes live in `@brimveyn/aimux-config` and are
// re-exported here so every import site in `src/` keeps working unchanged.
//
// They used to be declared in both places, "kept structurally identical" by
// hand. They were not: `TabSession.sessionId`, `TabSession.hibernated`,
// `ProjectRecord.defaultBaseRef`, `ProjectRecord.collapsed`,
// `PersistedTabSnapshot.workerName` and the terminal cursor/palette fields had
// all landed on one side only. A public plugin API cannot rest on that, so
// there is now one definition and this file re-exports it.
//
// What stays here is what a type module cannot hold: values.

export type {
  AppState,
  AssistantId,
  AutoCommitState,
  AutoCommitSuggestion,
  BarSide,
  BarsState,
  BarState,
  BarWidget,
  BranchDivergence,
  BuiltinAssistantId,
  DiffData,
  DiffFileStatus,
  DirectoryResult,
  DirectoryResultType,
  DiscoveredRepo,
  FlashJumpTarget,
  FlashJumpTargetKind,
  FlashLabel,
  FocusMode,
  FoldState,
  GitDiffView,
  GitFileEntry,
  GitFileListMode,
  GitFileSection,
  GitFileStatus,
  GitModeState,
  GitPaneDiffCountConfig,
  GitPanelError,
  GitPanelState,
  GitPanePathConfig,
  GitPaneState,
  GitRefreshPayload,
  HighlightsEntry,
  LayoutState,
  LegacyPersistedTabStatus,
  ModalClosed,
  ModalCreateProject,
  ModalCreateWorkspace,
  ModalFlashJump,
  ModalGitCommit,
  ModalHelp,
  ModalNewTab,
  ModalProjectName,
  ModalProjectPicker,
  ModalQuotas,
  ModalRenameTab,
  ModalRenameWorkspace,
  ModalSettingsSearch,
  ModalSettingText,
  ModalSnippetEditor,
  ModalSnippetPicker,
  ModalSplitPicker,
  ModalState,
  ModalThemePicker,
  ModalType,
  ModalUpdateAvailable,
  ModalWorkspaceDeleteConfirm,
  ModalWorkspaceMove,
  ModalWorkspaceMoveConfirm,
  MultiRepoState,
  ParsedDiffEntry,
  PendingWorkspaceLaunch,
  PersistedTabSnapshot,
  ProjectBarState,
  ProjectRecord,
  ProjectSnapshotV1,
  ProjectStatus,
  QuestionKind,
  ScrollIntent,
  SettingsUIState,
  SnippetRecord,
  StatsUIState,
  TabActivity,
  TabSession,
  TabStatus,
  TerminalCursorStyle,
  TerminalLine,
  TerminalModeState,
  TerminalSnapshot,
  TerminalSpan,
  WorkspaceActivity,
  WorkspaceRecord,
  WorkspaceSource,
} from '@brimveyn/aimux-config'

import type {
  AutoCommitState,
  HighlightsEntry,
  MultiRepoState,
  ParsedDiffEntry,
  WorkspaceActivity,
} from '@brimveyn/aimux-config'
import type { ThemedToken } from 'shiki'

export const IDLE_WORKSPACE_ACTIVITY: WorkspaceActivity = {
  done: false,
  waiting: false,
  working: false,
}

/**
 * The parsed diff is stored as `unknown` at the state boundary — the reducer
 * has no business knowing the diff-parser's shape — and narrowed here at the
 * read sites that do.
 */
export function getParsedPayload<T>(entry: ParsedDiffEntry | undefined): T | null {
  if (!entry) return null
  return entry.file as T | null
}

export function getHighlightsTokens(entry: HighlightsEntry | undefined): {
  add: ThemedToken[][]
  del: ThemedToken[][]
} | null {
  if (!entry) return null
  return {
    add: entry.add as ThemedToken[][],
    del: entry.del as ThemedToken[][],
  }
}

export const EMPTY_MULTI_REPO_STATE: MultiRepoState = { prefixes: {}, repos: [] }

export const EMPTY_AUTO_COMMIT_STATE: AutoCommitState = { byProject: {} }
