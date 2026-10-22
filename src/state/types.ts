// The application state shapes live in `@brimveyn/aimux-config` and are
// re-exported here so every import site in `src/` keeps working unchanged.
//
// They used to be declared in both places, "kept structurally identical" by
// hand. They were not: `TabSession.sessionId`, `TabSession.hibernated` (now `restoreOnFocus`),
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
  BarSide,
  BarsState,
  BarState,
  BarWidget,
  BranchDivergence,
  DiffData,
  DiffFileStatus,
  DirectoryResult,
  DiscoveredRepo,
  FlashJumpTarget,
  FlashLabel,
  FocusMode,
  FoldState,
  GitDiffView,
  GitFileEntry,
  GitFileListMode,
  GitFileSection,
  GitFileStatus,
  GitMarkdownView,
  GitModeState,
  GitPaneDiffCountConfig,
  GitPanelError,
  GitPanelState,
  GitPanePathConfig,
  GitPaneState,
  GitPaneTab,
  GitRefreshPayload,
  HighlightsEntry,
  LayoutState,
  ModalState,
  ModalType,
  ModalWorkspaceMove,
  MultiRepoState,
  ParsedDiffEntry,
  PendingWorkspaceLaunch,
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
