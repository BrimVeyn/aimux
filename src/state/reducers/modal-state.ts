import { basename } from 'node:path'

import type { AppAction, AppState } from '../types'

import { collectHelpEntries } from '../../input/keymap/help-entries'
import { getActiveKeymap } from '../../input/keymap/keymap-ref'
import { getAllAssistantOptions } from '../../pty/command-registry'
import { filterThemeIds } from '../../ui/filter-themes'
import { buildFlashJumpLabels } from '../../ui/flash/build-labels'
import {
  type BaseRefOption,
  buildBaseRefOptions,
  filterAssistants,
  filterSessions,
  filterSnippets,
  getTemplateNoneOffset,
} from '../selectors'
import { getActiveWorktree } from '../session-worktrees'
import { reduceAutoCommitState } from './auto-commit-state'

function emptyModal() {
  return {
    cursorPos: 0,
    editBuffer: null,
    selectedIndex: 0,
    sessionTargetId: null,
    type: null,
  } as const
}

export { emptyModal }

function clampCursor(value: number, max: number): number {
  return Math.max(0, Math.min(max, value))
}

function getCurrentWorktreeCount(state: AppState): number {
  if (!(state.currentSessionId != null && state.currentSessionId !== '')) return 0
  return state.sessions.find((entry) => entry.id === state.currentSessionId)?.worktrees?.length ?? 0
}

function getCurrentWorktreeIndex(state: AppState): number {
  if (!(state.currentSessionId != null && state.currentSessionId !== '')) return 0
  const session = state.sessions.find((entry) => entry.id === state.currentSessionId)
  return Math.max(
    0,
    (session?.worktrees ?? []).findIndex((worktree) => worktree.id === session?.activeWorktreeId)
  )
}

function getNewTabBaseOptions(state: AppState, queryOverride?: string): BaseRefOption[] {
  if (state.modal.type !== 'new-tab') return []
  const worktrees =
    state.sessions.find((entry) => entry.id === state.currentSessionId)?.worktrees ?? []
  return buildBaseRefOptions(
    worktrees,
    state.modal.baseBranches,
    queryOverride ?? state.modal.baseQuery
  )
}

function getCreateWorktreeBaseOptions(state: AppState, queryOverride?: string): BaseRefOption[] {
  if (state.modal.type !== 'create-worktree') return []
  const worktrees =
    state.sessions.find((entry) => entry.id === state.currentSessionId)?.worktrees ?? []
  return buildBaseRefOptions(
    worktrees,
    state.modal.baseBranches,
    queryOverride ?? state.modal.baseQuery
  )
}

const CREATE_WORKTREE_FIELDS = ['name', 'branch', 'base'] as const

type CreateWorktreeField = (typeof CREATE_WORKTREE_FIELDS)[number]

/** The buffer a create-worktree field edits, so cursor math has one source. */
function getCreateWorktreeFieldValue(
  modal: { worktreeName: string; branchName: string; baseQuery: string },
  field: CreateWorktreeField
): string {
  if (field === 'name') return modal.worktreeName
  if (field === 'branch') return modal.branchName
  return modal.baseQuery
}

function getSelectedNewTabAssistant(state: AppState, assistantId?: string) {
  if (assistantId != null && assistantId !== '') {
    return getAllAssistantOptions(state.customCommands).find((entry) => entry.id === assistantId)
  }
  if (state.modal.type !== 'new-tab') return
  return filterAssistants(getAllAssistantOptions(state.customCommands), state.modal.editBuffer)[
    state.modal.selectedIndex
  ]
}

export function reduceModalState(state: AppState, action: AppAction): AppState | null {
  switch (action.type) {
    case 'open-new-tab-modal': {
      const targetWorktreeIndex = getCurrentWorktreeIndex(state)
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          activeField: 'assistant',
          baseBranches: [],
          baseQuery: '',
          baseRef: '',
          branchError: null,
          branchName: '',
          createWorktree: false,
          cursorPos: 0,
          editBuffer: '',
          editingCommand: null,
          selectedAssistantId: null,
          selectedIndex: 0,
          sessionTargetId: null,
          step: 'assistant',
          targetWorktreeIndex,
          type: 'new-tab',
          worktreeDeletePrompt: null,
          worktreeName: '',
        },
      }
    }
    case 'enter-new-tab-worktree-create': {
      if (state.modal.type !== 'new-tab') return state
      // Default the base to the branch of the worktree we're forking from (the
      // current target), preserving the previous always-fork-from-source
      // behaviour until the user picks another base.
      const session = state.sessions.find((entry) => entry.id === state.currentSessionId)
      const sourceWorktree = session?.worktrees?.[state.modal.targetWorktreeIndex]
      return {
        ...state,
        modal: {
          ...state.modal,
          activeField: 'worktree-name',
          baseQuery: '',
          baseRef: sourceWorktree?.branch ?? '',
          createWorktree: true,
          cursorPos: state.modal.worktreeName.length,
          selectedIndex: 0,
          step: 'worktree-create',
        },
      }
    }
    case 'set-new-tab-base-branches': {
      if (state.modal.type !== 'new-tab') return state
      const modalWithBranches = { ...state.modal, baseBranches: action.branches }
      const withBranches: AppState = { ...state, modal: modalWithBranches }
      // Backfill a default base if none resolved yet (e.g. detached source).
      if (state.modal.baseRef !== '') return withBranches
      const firstOption = getNewTabBaseOptions(withBranches)[0]
      return {
        ...withBranches,
        modal: { ...modalWithBranches, baseRef: firstOption?.ref ?? '' },
      }
    }
    case 'enter-new-tab-template-pick': {
      if (state.modal.type !== 'new-tab') return state
      return {
        ...state,
        modal: {
          ...state.modal,
          activeField: 'target-worktree',
          cursorPos: 0,
          selectedIndex: 0,
          step: 'template',
        },
      }
    }
    case 'enter-new-tab-template-shortcut': {
      if (state.modal.type !== 'new-tab') return state
      const defaultName = state.modal.worktreeName || 'wt-template'
      return {
        ...state,
        modal: {
          ...state.modal,
          activeField: 'worktree-name',
          createWorktree: true,
          cursorPos: defaultName.length,
          selectedAssistantId: null,
          selectedIndex: 0,
          step: 'worktree-create',
          worktreeName: defaultName,
        },
      }
    }
    case 'set-new-tab-worktree-delete-prompt': {
      if (state.modal.type !== 'new-tab') return state
      return {
        ...state,
        modal: {
          ...state.modal,
          worktreeDeletePrompt: action.prompt,
        },
      }
    }
    case 'set-new-tab-branch-error': {
      if (state.modal.type !== 'new-tab') return state
      return {
        ...state,
        modal: {
          ...state.modal,
          activeField: 'branch-name',
          branchError: action.message,
          cursorPos: state.modal.branchName.length,
        },
      }
    }
    case 'select-new-tab-assistant': {
      if (state.modal.type !== 'new-tab' || state.modal.editingCommand !== null) return state
      if (
        action.assistantId === undefined &&
        state.modal.step === 'assistant' &&
        state.worktreeTemplates.length > 0
      ) {
        const filtered = filterAssistants(
          getAllAssistantOptions(state.customCommands),
          state.modal.editBuffer
        )
        if (state.modal.selectedIndex >= filtered.length) {
          const defaultName = state.modal.worktreeName || 'wt-template'
          return {
            ...state,
            modal: {
              ...state.modal,
              activeField: 'worktree-name',
              createWorktree: true,
              cursorPos: defaultName.length,
              selectedAssistantId: null,
              selectedIndex: 0,
              step: 'worktree-create',
              worktreeName: defaultName,
            },
          }
        }
      }
      const option = getSelectedNewTabAssistant(state, action.assistantId)
      if (!option) return state
      const targetWorktreeIndex = getCurrentWorktreeIndex(state)
      const worktreeCount = getCurrentWorktreeCount(state)
      return {
        ...state,
        modal: {
          ...state.modal,
          activeField: 'target-worktree',
          branchError: null,
          createWorktree: worktreeCount === 0,
          cursorPos: 0,
          selectedAssistantId: option.id,
          selectedIndex: worktreeCount === 0 ? 0 : targetWorktreeIndex,
          step: 'worktree',
          targetWorktreeIndex,
          worktreeDeletePrompt: null,
          worktreeName: state.modal.worktreeName || `wt-${option.label}`,
        },
      }
    }
    case 'toggle-new-tab-worktree': {
      if (state.modal.type !== 'new-tab' || state.modal.editingCommand !== null) return state
      const createWorktree = !state.modal.createWorktree
      const option = getSelectedNewTabAssistant(state, action.assistantId)
      const defaultName = state.modal.worktreeName || `wt-${option?.label ?? 'assistant'}`
      const worktreeCount = getCurrentWorktreeCount(state)
      const targetWorktreeIndex = getCurrentWorktreeIndex(state)
      let activeField = state.modal.activeField
      if (createWorktree) {
        activeField = state.modal.step === 'worktree' || option ? 'target-worktree' : activeField
      } else if (activeField === 'worktree-name') {
        activeField = 'target-worktree'
      }
      const cursorPos =
        createWorktree && worktreeCount <= 0
          ? defaultName.length
          : (state.modal.editBuffer?.length ?? 0)
      return {
        ...state,
        modal: {
          ...state.modal,
          activeField,
          createWorktree,
          cursorPos,
          selectedAssistantId: option?.id ?? state.modal.selectedAssistantId,
          selectedIndex: createWorktree
            ? worktreeCount
            : Math.min(state.modal.selectedIndex, Math.max(0, worktreeCount - 1)),
          step: option && createWorktree ? 'worktree' : state.modal.step,
          targetWorktreeIndex,
          worktreeDeletePrompt: null,
          worktreeName: defaultName,
        },
      }
    }
    case 'open-edit-custom-command': {
      if (state.modal.type !== 'new-tab') return state
      const current = state.customCommands[action.assistantId] ?? ''
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          ...state.modal,
          cursorPos: current.length,
          editBuffer: current,
          editingCommand: action.assistantId,
        },
      }
    }
    case 'open-ai-usage-modal': {
      return {
        ...state,
        focusMode: 'modal',
        modal: {
          cursorPos: 0,
          editBuffer: '',
          selectedIndex: 0,
          sessionTargetId: null,
          type: 'ai-usage',
        },
      }
    }
    case 'open-worktree-move-modal': {
      // Overlay: keep focusMode (git when opened via `m`, navigation when opened
      // from a tab menu) so the view underneath stays mounted, like the help
      // modal. deriveModeId routes input to the picker while open.
      return {
        ...state,
        modal: {
          deleteSource: false,
          editBuffer: null,
          selectedIndex: 0,
          sessionTargetId: null,
          sourceWorktreeId: action.sourceWorktreeId,
          stats: { kind: 'loading' },
          type: 'worktree-move',
        },
      }
    }
    case 'toggle-worktree-move-delete': {
      if (state.modal.type !== 'worktree-move') return state
      return {
        ...state,
        modal: { ...state.modal, deleteSource: !state.modal.deleteSource },
      }
    }
    case 'set-worktree-move-stats': {
      if (state.modal.type !== 'worktree-move') return state
      return {
        ...state,
        modal: { ...state.modal, stats: { dirtyFiles: action.dirtyFiles, kind: 'ready' } },
      }
    }
    case 'open-worktree-move-confirm': {
      return {
        ...state,
        focusMode: 'modal',
        modal: {
          deleteSource: action.deleteSource,
          editBuffer: null,
          files: action.files,
          selectedIndex: 0,
          sessionId: action.sessionId,
          sessionTargetId: null,
          sourceLabel: action.sourceLabel,
          sourceWorktreeId: action.sourceWorktreeId,
          targetLabel: action.targetLabel,
          targetWorktreeId: action.targetWorktreeId,
          type: 'worktree-move-confirm',
          variant: action.variant,
        },
      }
    }
    case 'open-worktree-delete-confirm': {
      return {
        ...state,
        focusMode: 'modal',
        modal: {
          closeTabs: action.closeTabs,
          editBuffer: null,
          force: action.force,
          reason: action.reason,
          selectedIndex: 0,
          sessionId: action.sessionId,
          sessionTargetId: null,
          type: 'worktree-delete-confirm',
          worktreeId: action.worktreeId,
          worktreeLabel: action.worktreeLabel,
        },
      }
    }
    case 'open-flash-jump-modal': {
      const labels = buildFlashJumpLabels(state)
      // Even when there are zero jump targets we still open the overlay (the
      // user pressed `S` expecting it); the next keystroke that matches
      // nothing closes it via the empty-match path in update-command-edit.
      return {
        ...state,
        modal: {
          buffer: '',
          cursorPos: 0,
          editBuffer: '',
          labels,
          pendingJump: null,
          selectedIndex: 0,
          sessionTargetId: null,
          type: 'flash-jump',
        },
      }
    }
    case 'clear-flash-jump-pending': {
      if (state.modal.type !== 'flash-jump') return state
      if (state.modal.pendingJump === null) return state
      return { ...state, modal: { ...state.modal, pendingJump: null } }
    }
    case 'open-help-modal': {
      const keymap = getActiveKeymap()
      const scope = action.scope ?? null
      const allEntries = keymap ? collectHelpEntries(keymap) : []
      const scopedEntries = scope ? allEntries.filter((e) => e.mode === scope) : allEntries
      return {
        ...state,
        modal: {
          cursorPos: 0,
          editBuffer: '',
          entryCount: scopedEntries.length,
          scope,
          selectedIndex: 0,
          sessionTargetId: null,
          type: 'help',
        },
      }
    }
    case 'open-split-picker':
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          cursorPos: 0,
          editBuffer: '',
          selectedIndex: 0,
          sessionTargetId: null,
          splitDirection: action.direction,
          type: 'split-picker',
        },
      }
    case 'open-session-picker':
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          cursorPos: 0,
          editBuffer: '',
          selectedIndex: 0,
          sessionTargetId: null,
          type: 'session-picker',
        },
      }
    case 'open-session-name-modal': {
      const initialName = action.initialName ?? ''
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          cursorPos: initialName.length,
          editBuffer: initialName,
          returnToSessionPicker: action.returnToSessionPicker ?? true,
          selectedIndex: 0,
          sessionTargetId: action.sessionTargetId ?? null,
          type: 'session-name',
        },
      }
    }
    case 'open-create-session-modal':
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          activeField: 'directory',
          cursorPos: 0,
          directoryResults: [],
          editBuffer: '',
          nameBuffer: '',
          pendingProjectPath: null,
          returnToSessionPicker: action.returnToSessionPicker,
          selectedIndex: 0,
          sessionTargetId: null,
          type: 'create-session',
        },
      }
    case 'set-directory-results': {
      if (state.modal.type !== 'create-session') {
        return state
      }
      return {
        ...state,
        modal: {
          ...state.modal,
          directoryResults: action.results,
          selectedIndex: 0,
        },
      }
    }
    case 'open-create-worktree-modal':
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          activeField: 'name',
          baseBranches: [],
          baseQuery: '',
          // Default to the active worktree's branch, preserving the previous
          // always-fork-from-source behaviour until the user picks another base.
          baseRef:
            getActiveWorktree(state.sessions.find((entry) => entry.id === state.currentSessionId))
              ?.branch ?? '',
          branchError: null,
          branchName: '',
          cursorPos: 0,
          editBuffer: '',
          selectedIndex: 0,
          sessionTargetId: null,
          step: 'form',
          type: 'create-worktree',
          worktreeName: '',
        },
      }
    case 'switch-create-worktree-field': {
      if (state.modal.type !== 'create-worktree') return state
      const next =
        CREATE_WORKTREE_FIELDS[
          (CREATE_WORKTREE_FIELDS.indexOf(state.modal.activeField) + 1) %
            CREATE_WORKTREE_FIELDS.length
        ] ?? 'name'
      const buffer = getCreateWorktreeFieldValue(state.modal, next)
      return {
        ...state,
        modal: {
          ...state.modal,
          activeField: next,
          cursorPos: buffer.length,
          selectedIndex: 0,
        },
      }
    }
    case 'set-create-worktree-base-branches': {
      if (state.modal.type !== 'create-worktree') return state
      const modalWithBranches = { ...state.modal, baseBranches: action.branches }
      const withBranches: AppState = { ...state, modal: modalWithBranches }
      // Backfill a default base if none resolved yet (e.g. detached source).
      if (state.modal.baseRef !== '') return withBranches
      const firstOption = getCreateWorktreeBaseOptions(withBranches)[0]
      return {
        ...withBranches,
        modal: { ...modalWithBranches, baseRef: firstOption?.ref ?? '' },
      }
    }
    case 'set-create-worktree-branch-error': {
      if (state.modal.type !== 'create-worktree') return state
      return {
        ...state,
        modal: {
          ...state.modal,
          activeField: 'branch',
          branchError: action.message,
          cursorPos: state.modal.branchName.length,
        },
      }
    }
    case 'set-create-worktree-step': {
      if (state.modal.type !== 'create-worktree') return state
      if (state.modal.step === action.step) return state
      return {
        ...state,
        modal: {
          ...state.modal,
          cursorPos: action.step === 'form' ? state.modal.worktreeName.length : 0,
          // Returning to the form always lands on the name field, so the
          // cursor above matches whatever the user sees.
          ...(action.step === 'form' ? { activeField: 'name' as const } : null),
          selectedIndex: 0,
          step: action.step,
        },
      }
    }
    case 'open-snippet-picker':
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          actionMessage: null,
          cursorPos: 0,
          editBuffer: '',
          selectedIndex: 0,
          sessionTargetId: null,
          type: 'snippet-picker',
        },
      }
    case 'snippet-picker-set-message': {
      if (state.modal.type !== 'snippet-picker') return state
      if (state.modal.actionMessage === action.message) return state
      return { ...state, modal: { ...state.modal, actionMessage: action.message } }
    }
    case 'open-snippet-editor': {
      const snippet =
        action.snippetId != null && action.snippetId !== ''
          ? state.snippets.find((s) => s.id === action.snippetId)
          : undefined
      const initialName = snippet?.name ?? ''
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          activeField: 'name',
          contentBuffer: snippet?.content ?? '',
          cursorPos: initialName.length,
          editBuffer: initialName,
          nameBuffer: initialName,
          selectedIndex: 0,
          sessionTargetId: snippet?.id ?? null,
          triggerBuffer: snippet?.trigger ?? '',
          type: 'snippet-editor',
        },
      }
    }
    case 'open-theme-picker':
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          cursorPos: 0,
          editBuffer: '',
          entryCount: 0,
          selectedIndex: 0,
          sessionTargetId: null,
          type: 'theme-picker',
        },
      }
    case 'open-update-available-modal':
      return {
        ...state,
        focusMode: 'modal',
        modal: {
          currentVersion: action.currentVersion,
          cursorPos: 0,
          editBuffer: null,
          latestVersion: action.latestVersion,
          selectedIndex: 0,
          sessionTargetId: null,
          type: 'update-available',
        },
      }
    case 'open-git-commit-modal': {
      const sessionId = action.sessionId
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          activeField: 'title',
          contentBuffer: '',
          cursorPos: 0,
          editBuffer: '',
          selectedIndex: 0,
          sessionTargetId: sessionId ?? null,
          stage: 'edit',
          type: 'git-commit',
        },
      }
    }
    case 'git-commit-enter-confirm': {
      if (state.modal.type !== 'git-commit') return state
      return {
        ...state,
        focusMode: 'command-edit',
        modal: { ...state.modal, stage: 'confirm' },
      }
    }
    case 'git-commit-leave-confirm': {
      if (state.modal.type !== 'git-commit') return state
      return {
        ...state,
        focusMode: 'command-edit',
        modal: { ...state.modal, stage: 'edit' },
      }
    }
    case 'git-commit-enter-generating': {
      if (state.modal.type !== 'git-commit') return state
      return {
        ...state,
        focusMode: 'modal',
        modal: { ...state.modal, sessionTargetId: action.sessionId, stage: 'generating' },
      }
    }
    case 'git-commit-leave-generating': {
      if (state.modal.type !== 'git-commit') return state
      return {
        ...state,
        focusMode: 'command-edit',
        modal: { ...state.modal, stage: 'edit' },
      }
    }
    case 'auto-commit-generation-ready': {
      if (
        state.modal.type !== 'git-commit' ||
        state.modal.stage !== 'generating' ||
        state.modal.sessionTargetId !== action.sessionId
      ) {
        return null
      }
      const nextAutoCommit = reduceAutoCommitState(state.autoCommit, action)
      if (!nextAutoCommit) {
        // Stale result (hash mismatch or slice was cleared mid-flight): don't
        // strand the modal in `generating` — flip back to edit so the user
        // isn't stuck staring at a spinner that will never resolve.
        return {
          ...state,
          focusMode: 'command-edit',
          modal: { ...state.modal, stage: 'edit' },
        }
      }
      return {
        ...state,
        autoCommit: nextAutoCommit,
        focusMode: 'command-edit',
        modal: {
          ...state.modal,
          activeField: 'title',
          contentBuffer: action.body,
          cursorPos: action.title.length,
          editBuffer: action.title,
          stage: 'confirm',
        },
      }
    }
    case 'git-commit-use-background-suggestion': {
      if (state.modal.type !== 'git-commit' || state.modal.sessionTargetId !== action.sessionId) {
        return null
      }
      const suggestion = state.autoCommit.bySession[action.sessionId]
      if (!suggestion || suggestion.kind !== 'ready') return null
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          ...state.modal,
          activeField: 'title',
          contentBuffer: suggestion.body,
          cursorPos: suggestion.title.length,
          editBuffer: suggestion.title,
          stage: 'confirm',
        },
      }
    }
    case 'auto-commit-clear': {
      if (
        state.modal.type !== 'git-commit' ||
        state.modal.stage !== 'generating' ||
        state.modal.sessionTargetId !== action.sessionId
      ) {
        return null
      }
      const nextAutoCommit = reduceAutoCommitState(state.autoCommit, action)
      return {
        ...state,
        autoCommit: nextAutoCommit ?? state.autoCommit,
        focusMode: 'command-edit',
        modal: { ...state.modal, stage: 'edit' },
      }
    }
    case 'set-help-entry-count': {
      if (state.modal.type !== 'help') return state
      if (state.modal.entryCount === action.count) {
        // Still clamp selectedIndex in case the count shrank below it.
        const clamped = Math.min(state.modal.selectedIndex, Math.max(0, action.count - 1))
        if (clamped === state.modal.selectedIndex) return state
        return { ...state, modal: { ...state.modal, selectedIndex: clamped } }
      }
      const clamped = Math.min(state.modal.selectedIndex, Math.max(0, action.count - 1))
      return {
        ...state,
        modal: { ...state.modal, entryCount: action.count, selectedIndex: clamped },
      }
    }
    case 'set-theme-entry-count': {
      if (state.modal.type !== 'theme-picker') return state
      const clamped = Math.min(state.modal.selectedIndex, Math.max(0, action.count - 1))
      if (state.modal.entryCount === action.count && clamped === state.modal.selectedIndex) {
        return state
      }
      return {
        ...state,
        modal: { ...state.modal, entryCount: action.count, selectedIndex: clamped },
      }
    }
    case 'close-modal': {
      const closingType = state.modal.type
      // Pure overlays never flipped focusMode (they render on top of git mode),
      // so leave it alone — closing returns to whatever was underneath.
      if (
        closingType === 'help' ||
        closingType === 'worktree-move' ||
        closingType === 'flash-jump'
      ) {
        return { ...state, modal: emptyModal() }
      }
      const nextFocus: AppState['focusMode'] = closingType === 'git-commit' ? 'git' : 'navigation'
      return { ...state, focusMode: nextFocus, modal: emptyModal() }
    }
    case 'move-modal-selection': {
      if (state.modal.type === 'help') {
        const count = state.modal.entryCount
        if (count <= 0) return state
        const raw = state.modal.selectedIndex + action.delta
        const nextIndex = ((raw % count) + count) % count
        if (nextIndex === state.modal.selectedIndex) return state
        return { ...state, modal: { ...state.modal, selectedIndex: nextIndex } }
      }
      if (
        state.modal.type !== 'new-tab' &&
        state.modal.type !== 'session-picker' &&
        state.modal.type !== 'snippet-picker' &&
        state.modal.type !== 'theme-picker' &&
        state.modal.type !== 'create-session' &&
        state.modal.type !== 'create-worktree' &&
        state.modal.type !== 'split-picker' &&
        state.modal.type !== 'update-available' &&
        state.modal.type !== 'worktree-move'
      ) {
        return state
      }
      if (state.modal.type === 'create-session' && state.modal.activeField !== 'directory') {
        return state
      }
      if (state.modal.type === 'create-worktree') {
        if (state.modal.step === 'template') {
          const count = state.worktreeTemplates.length
          if (count === 0) return state
          return {
            ...state,
            modal: {
              ...state.modal,
              selectedIndex: (state.modal.selectedIndex + action.delta + count) % count,
            },
          }
        }
        if (state.modal.activeField !== 'base') return state
        const options = getCreateWorktreeBaseOptions(state)
        if (options.length === 0) return state
        const next = (state.modal.selectedIndex + action.delta + options.length) % options.length
        return {
          ...state,
          modal: {
            ...state.modal,
            baseRef: options[next]?.ref ?? state.modal.baseRef,
            selectedIndex: next,
          },
        }
      }
      if (state.modal.type === 'new-tab' && state.modal.step === 'worktree-create') {
        if (state.modal.activeField !== 'base') return state
        const options = getNewTabBaseOptions(state)
        if (options.length === 0) return state
        const next = (state.modal.selectedIndex + action.delta + options.length) % options.length
        return {
          ...state,
          modal: {
            ...state.modal,
            baseRef: options[next]?.ref ?? state.modal.baseRef,
            selectedIndex: next,
          },
        }
      }
      let optionCount: number
      if (state.modal.type === 'new-tab') {
        if (state.modal.step === 'worktree') {
          if (state.modal.activeField === 'worktree-name') return state
          optionCount = getCurrentWorktreeCount(state) + 1
        } else if (state.modal.step === 'template') {
          optionCount =
            state.worktreeTemplates.length + getTemplateNoneOffset(state.modal.selectedAssistantId)
        } else {
          optionCount =
            filterAssistants(getAllAssistantOptions(state.customCommands), state.modal.editBuffer)
              .length + (state.worktreeTemplates.length > 0 ? 1 : 0)
        }
      } else if (state.modal.type === 'split-picker') {
        optionCount = getAllAssistantOptions(state.customCommands).length
      } else if (state.modal.type === 'create-session') {
        optionCount = state.modal.directoryResults.length
      } else if (state.modal.type === 'snippet-picker') {
        const filtered = filterSnippets(state.snippets, state.modal.editBuffer)
        optionCount = filtered.length
      } else if (state.modal.type === 'theme-picker') {
        optionCount = filterThemeIds(state.modal.editBuffer).length
      } else if (state.modal.type === 'update-available') {
        optionCount = 2
      } else if (state.modal.type === 'worktree-move') {
        optionCount = Math.max(0, getCurrentWorktreeCount(state) - 1)
      } else {
        const filtered = filterSessions(state.sessions, state.modal.editBuffer)
        optionCount = Math.max(1, filtered.length + 1)
      }
      if (optionCount === 0) {
        return state
      }
      return {
        ...state,
        modal: {
          ...state.modal,
          selectedIndex: (state.modal.selectedIndex + action.delta + optionCount) % optionCount,
          ...(state.modal.type === 'new-tab' && state.modal.step === 'worktree'
            ? {
                createWorktree:
                  (state.modal.selectedIndex + action.delta + optionCount) % optionCount ===
                  optionCount - 1,
                worktreeDeletePrompt: null,
              }
            : null),
        },
      }
    }
    case 'set-modal-selection-index': {
      if (
        state.modal.type !== 'new-tab' &&
        state.modal.type !== 'session-picker' &&
        state.modal.type !== 'snippet-picker' &&
        state.modal.type !== 'theme-picker' &&
        state.modal.type !== 'create-session' &&
        state.modal.type !== 'create-worktree' &&
        state.modal.type !== 'split-picker' &&
        state.modal.type !== 'update-available' &&
        state.modal.type !== 'worktree-move' &&
        state.modal.type !== 'help'
      ) {
        return state
      }
      if (state.modal.type === 'create-worktree') {
        if (state.modal.step === 'template') {
          const count = state.worktreeTemplates.length
          if (count === 0) return state
          const clamped = Math.max(0, Math.min(count - 1, action.index))
          if (clamped === state.modal.selectedIndex) return state
          return { ...state, modal: { ...state.modal, selectedIndex: clamped } }
        }
        if (state.modal.activeField !== 'base') return state
        const options = getCreateWorktreeBaseOptions(state)
        if (options.length === 0) return state
        const clamped = Math.max(0, Math.min(options.length - 1, action.index))
        if (clamped === state.modal.selectedIndex) return state
        return {
          ...state,
          modal: {
            ...state.modal,
            baseRef: options[clamped]?.ref ?? state.modal.baseRef,
            selectedIndex: clamped,
          },
        }
      }
      if (state.modal.type === 'new-tab' && state.modal.step === 'worktree-create') {
        if (state.modal.activeField !== 'base') return state
        const options = getNewTabBaseOptions(state)
        if (options.length === 0) return state
        const clamped = Math.max(0, Math.min(options.length - 1, action.index))
        if (clamped === state.modal.selectedIndex) return state
        return {
          ...state,
          modal: {
            ...state.modal,
            baseRef: options[clamped]?.ref ?? state.modal.baseRef,
            selectedIndex: clamped,
          },
        }
      }
      let optionCount: number
      if (state.modal.type === 'help') {
        optionCount = state.modal.entryCount
      } else if (state.modal.type === 'new-tab') {
        if (state.modal.step === 'worktree') {
          optionCount = getCurrentWorktreeCount(state) + 1
        } else if (state.modal.step === 'template') {
          optionCount =
            state.worktreeTemplates.length + getTemplateNoneOffset(state.modal.selectedAssistantId)
        } else {
          optionCount =
            filterAssistants(getAllAssistantOptions(state.customCommands), state.modal.editBuffer)
              .length + (state.worktreeTemplates.length > 0 ? 1 : 0)
        }
      } else if (state.modal.type === 'split-picker') {
        optionCount = getAllAssistantOptions(state.customCommands).length
      } else if (state.modal.type === 'create-session') {
        optionCount = state.modal.directoryResults.length
      } else if (state.modal.type === 'snippet-picker') {
        optionCount = filterSnippets(state.snippets, state.modal.editBuffer).length
      } else if (state.modal.type === 'theme-picker') {
        optionCount = filterThemeIds(state.modal.editBuffer).length
      } else if (state.modal.type === 'update-available') {
        optionCount = 2
      } else if (state.modal.type === 'worktree-move') {
        optionCount = Math.max(0, getCurrentWorktreeCount(state) - 1)
      } else {
        optionCount = Math.max(1, filterSessions(state.sessions, state.modal.editBuffer).length + 1)
      }
      if (optionCount === 0) return state
      const clamped = Math.max(0, Math.min(optionCount - 1, action.index))
      if (state.modal.type === 'new-tab' && state.modal.step === 'worktree') {
        if (clamped === state.modal.selectedIndex) return state
        return {
          ...state,
          modal: {
            ...state.modal,
            createWorktree: clamped === optionCount - 1,
            selectedIndex: clamped,
            worktreeDeletePrompt: null,
          },
        }
      }
      if (clamped === state.modal.selectedIndex) return state
      return { ...state, modal: { ...state.modal, selectedIndex: clamped } }
    }
    case 'move-modal-cursor': {
      if (state.modal.editBuffer === null) return state
      let editableValue = state.modal.editBuffer
      if (state.modal.type === 'new-tab' && state.modal.editingCommand === null) {
        if (state.modal.activeField === 'worktree-name') {
          editableValue = state.modal.worktreeName
        } else if (state.modal.activeField === 'branch-name') {
          editableValue = state.modal.branchName
        }
      }
      if (
        state.modal.type === 'new-tab' &&
        state.modal.editingCommand === null &&
        (state.modal.step === 'template' ||
          (state.modal.step === 'worktree' && state.modal.activeField === 'target-worktree'))
      ) {
        return state
      }
      const len = editableValue.length
      const current = state.modal.cursorPos ?? len
      let next = current
      if (action.to === 'home') next = 0
      else if (action.to === 'end') next = len
      else if (typeof action.delta === 'number') next = current + action.delta
      next = clampCursor(next, len)
      if (next === current) return state
      return { ...state, modal: { ...state.modal, cursorPos: next } }
    }
    case 'update-command-edit': {
      // Flash-jump: each letter narrows the matching label set. Closing the
      // modal on no-match mirrors the flash.nvim "miss = cancel" UX, and a
      // unique match exposes a pendingJump for app.tsx to execute.
      if (state.modal.type === 'flash-jump') {
        const buffer = state.modal.buffer
        if (action.char === '\b') {
          if (buffer.length === 0) return state
          return {
            ...state,
            modal: { ...state.modal, buffer: buffer.slice(0, -1), pendingJump: null },
          }
        }
        // Restrict to single lowercase ASCII letters — anything else (digits,
        // shift+letter, control sequences) closes the overlay rather than
        // poisoning the buffer.
        const ch = action.char.toLowerCase()
        if (ch.length !== 1 || ch < 'a' || ch > 'z') {
          return { ...state, focusMode: 'navigation', modal: emptyModal() }
        }
        const nextBuffer = buffer + ch
        const matches = state.modal.labels.filter((l) => l.label.startsWith(nextBuffer))
        if (matches.length === 0) {
          return { ...state, focusMode: 'navigation', modal: emptyModal() }
        }
        const onlyMatch = matches[0]
        if (matches.length === 1 && onlyMatch && onlyMatch.label === nextBuffer) {
          // Single full match: keep the modal open one tick with pendingJump
          // set — app.tsx consumes it, performs the jump, then clears the
          // modal. Storing it on the modal keeps a single source of truth.
          return {
            ...state,
            modal: { ...state.modal, buffer: nextBuffer, pendingJump: onlyMatch.target },
          }
        }
        return { ...state, modal: { ...state.modal, buffer: nextBuffer, pendingJump: null } }
      }
      if (state.modal.type === 'create-worktree') {
        // The template step is a pure picker — swallow typed characters.
        if (state.modal.step === 'template') return state
        const field = state.modal.activeField
        const current = getCreateWorktreeFieldValue(state.modal, field)
        const at = clampCursor(state.modal.cursorPos ?? current.length, current.length)
        let text: string
        let pos: number
        if (action.char === '\b') {
          if (at === 0) return state
          text = current.slice(0, at - 1) + current.slice(at)
          pos = at - 1
        } else {
          text = current.slice(0, at) + action.char + current.slice(at)
          pos = at + action.char.length
        }
        if (field === 'name') {
          return { ...state, modal: { ...state.modal, cursorPos: pos, worktreeName: text } }
        }
        if (field === 'branch') {
          return {
            ...state,
            modal: { ...state.modal, branchError: null, branchName: text, cursorPos: pos },
          }
        }
        // Re-filter and snap the base to the top match as the query changes.
        const topOption = getCreateWorktreeBaseOptions(state, text)[0]
        return {
          ...state,
          modal: {
            ...state.modal,
            baseQuery: text,
            baseRef: topOption?.ref ?? state.modal.baseRef,
            cursorPos: pos,
            selectedIndex: 0,
          },
        }
      }
      if (state.modal.editBuffer === null) {
        return state
      }
      let buffer = state.modal.editBuffer
      if (state.modal.type === 'new-tab' && state.modal.editingCommand === null) {
        if (state.modal.activeField === 'worktree-name') {
          buffer = state.modal.worktreeName
        } else if (state.modal.activeField === 'branch-name') {
          buffer = state.modal.branchName
        } else if (state.modal.activeField === 'base') {
          buffer = state.modal.baseQuery
        }
      }
      if (
        state.modal.type === 'new-tab' &&
        state.modal.editingCommand === null &&
        (state.modal.step === 'template' ||
          (state.modal.step === 'worktree' && state.modal.activeField === 'target-worktree'))
      ) {
        return state
      }
      const cursor = clampCursor(state.modal.cursorPos ?? buffer.length, buffer.length)
      let nextBuffer: string
      let nextCursor: number
      if (action.char === '\b') {
        if (cursor === 0) return state
        nextBuffer = buffer.slice(0, cursor - 1) + buffer.slice(cursor)
        nextCursor = cursor - 1
      } else {
        nextBuffer = buffer.slice(0, cursor) + action.char + buffer.slice(cursor)
        nextCursor = cursor + action.char.length
      }
      const isNewTabEditing = state.modal.type === 'new-tab' && state.modal.editingCommand !== null
      if (
        state.modal.type === 'new-tab' &&
        state.modal.editingCommand === null &&
        state.modal.activeField === 'worktree-name'
      ) {
        return {
          ...state,
          modal: {
            ...state.modal,
            cursorPos: nextCursor,
            worktreeName: nextBuffer,
          },
        }
      }
      if (
        state.modal.type === 'new-tab' &&
        state.modal.editingCommand === null &&
        state.modal.activeField === 'branch-name'
      ) {
        return {
          ...state,
          modal: {
            ...state.modal,
            branchError: null,
            branchName: nextBuffer,
            cursorPos: nextCursor,
          },
        }
      }
      if (
        state.modal.type === 'new-tab' &&
        state.modal.editingCommand === null &&
        state.modal.activeField === 'base'
      ) {
        // Re-filter and snap the selection/base to the top match as the query changes.
        const topOption = getNewTabBaseOptions(state, nextBuffer)[0]
        return {
          ...state,
          modal: {
            ...state.modal,
            baseQuery: nextBuffer,
            baseRef: topOption?.ref ?? state.modal.baseRef,
            cursorPos: nextCursor,
            selectedIndex: 0,
          },
        }
      }
      const resetIndex =
        !isNewTabEditing &&
        (state.modal.type === 'session-picker' ||
          state.modal.type === 'snippet-picker' ||
          state.modal.type === 'theme-picker' ||
          state.modal.type === 'new-tab' ||
          state.modal.type === 'help')
          ? 0
          : state.modal.selectedIndex
      return {
        ...state,
        modal: {
          ...state.modal,
          cursorPos: nextCursor,
          editBuffer: nextBuffer,
          selectedIndex: resetIndex,
        },
      }
    }
    case 'cancel-command-edit': {
      if (state.modal.type === 'new-tab' && state.modal.editingCommand !== null) {
        return {
          ...state,
          modal: {
            ...state.modal,
            cursorPos: 0,
            editBuffer: '',
            editingCommand: null,
          },
        }
      }
      if (state.modal.type === 'new-tab') {
        if (state.modal.step === 'template') {
          return {
            ...state,
            modal: {
              ...state.modal,
              activeField: 'worktree-name',
              cursorPos: state.modal.worktreeName.length,
              selectedIndex: 0,
              step: 'worktree-create',
            },
          }
        }
        if (state.modal.step === 'worktree-create') {
          const optionCount = getCurrentWorktreeCount(state) + 1
          return {
            ...state,
            modal: {
              ...state.modal,
              activeField: 'target-worktree',
              branchError: null,
              createWorktree: false,
              cursorPos: 0,
              selectedIndex: Math.min(
                state.modal.targetWorktreeIndex,
                Math.max(0, optionCount - 1)
              ),
              step: 'worktree',
            },
          }
        }
        if (state.modal.step === 'worktree') {
          const selectedAssistantId = state.modal.selectedAssistantId
          const assistants = filterAssistants(
            getAllAssistantOptions(state.customCommands),
            state.modal.editBuffer
          )
          const assistantIndex = assistants.findIndex(
            (assistant) => assistant.id === selectedAssistantId
          )
          return {
            ...state,
            modal: {
              ...state.modal,
              activeField: 'assistant',
              createWorktree: false,
              cursorPos: state.modal.editBuffer?.length ?? 0,
              selectedIndex: Math.max(0, assistantIndex),
              step: 'assistant',
              worktreeDeletePrompt: null,
            },
          }
        }
        return { ...state, focusMode: 'navigation', modal: emptyModal() }
      }
      if (state.modal.type === 'create-session' || state.modal.type === 'snippet-editor') {
        return { ...state, focusMode: 'navigation', modal: emptyModal() }
      }
      // Pickers and overlays with auto-filter — Esc closes the modal entirely.
      if (
        state.modal.type === 'session-picker' ||
        state.modal.type === 'snippet-picker' ||
        state.modal.type === 'theme-picker' ||
        state.modal.type === 'help'
      ) {
        return { ...state, focusMode: 'navigation', modal: emptyModal() }
      }
      return {
        ...state,
        focusMode: 'modal',
        modal: { ...state.modal, cursorPos: 0, editBuffer: null },
      }
    }
    case 'switch-create-session-field': {
      if (state.modal.type === 'create-session') {
        const nextField = state.modal.activeField === 'directory' ? 'name' : 'directory'
        const nextEdit = state.modal.nameBuffer
        return {
          ...state,
          modal: {
            ...state.modal,
            activeField: nextField,
            cursorPos: nextEdit.length,
            editBuffer: nextEdit,
            nameBuffer: state.modal.editBuffer ?? '',
          },
        }
      }
      if (state.modal.type === 'snippet-editor') {
        const current = state.modal.editBuffer ?? ''
        // Save current edit buffer back to the field it belongs to.
        const updatedBuffers = {
          contentBuffer:
            state.modal.activeField === 'content' ? current : state.modal.contentBuffer,
          nameBuffer: state.modal.activeField === 'name' ? current : state.modal.nameBuffer,
          triggerBuffer:
            state.modal.activeField === 'trigger' ? current : state.modal.triggerBuffer,
        }
        const cycle: Record<'name' | 'trigger' | 'content', 'name' | 'trigger' | 'content'> = {
          content: 'name',
          name: 'trigger',
          trigger: 'content',
        }
        const nextField = cycle[state.modal.activeField]
        const nextEditByField = {
          content: updatedBuffers.contentBuffer,
          name: updatedBuffers.nameBuffer,
          trigger: updatedBuffers.triggerBuffer,
        }
        const nextEdit = nextEditByField[nextField]
        return {
          ...state,
          modal: {
            ...state.modal,
            ...updatedBuffers,
            activeField: nextField,
            cursorPos: nextEdit.length,
            editBuffer: nextEdit,
          },
        }
      }
      if (state.modal.type === 'git-commit') {
        const nextField = state.modal.activeField === 'title' ? 'body' : 'title'
        const nextEdit = state.modal.contentBuffer
        return {
          ...state,
          modal: {
            ...state.modal,
            activeField: nextField,
            contentBuffer: state.modal.editBuffer ?? '',
            cursorPos: nextEdit.length,
            editBuffer: nextEdit,
          },
        }
      }
      if (state.modal.type === 'new-tab') {
        if (state.modal.step === 'assistant') return state
        if (state.modal.step === 'worktree-create') {
          const cycle: Record<
            'worktree-name' | 'branch-name' | 'base',
            typeof state.modal.activeField
          > = {
            'base': 'worktree-name',
            'branch-name': 'base',
            'worktree-name': 'branch-name',
          }
          const nextField =
            state.modal.activeField === 'worktree-name' ||
            state.modal.activeField === 'branch-name' ||
            state.modal.activeField === 'base'
              ? cycle[state.modal.activeField]
              : 'worktree-name'
          if (nextField === 'base') {
            // Highlight the row matching the resolved base ref when entering it.
            const currentBaseRef = state.modal.baseRef
            const options = getNewTabBaseOptions(state)
            const baseIndex = Math.max(
              0,
              options.findIndex((option) => option.ref === currentBaseRef)
            )
            return {
              ...state,
              modal: {
                ...state.modal,
                activeField: nextField,
                cursorPos: state.modal.baseQuery.length,
                selectedIndex: baseIndex,
              },
            }
          }
          const nextValue =
            nextField === 'branch-name' ? state.modal.branchName : state.modal.worktreeName
          return {
            ...state,
            modal: {
              ...state.modal,
              activeField: nextField,
              cursorPos: nextValue.length,
              selectedIndex: 0,
            },
          }
        }
        let nextField: typeof state.modal.activeField = 'target-worktree'
        if (state.modal.activeField === 'target-worktree' && state.modal.createWorktree) {
          nextField = 'worktree-name'
        }
        const nextValue =
          nextField === 'worktree-name' ? state.modal.worktreeName : (state.modal.editBuffer ?? '')
        return {
          ...state,
          modal: {
            ...state.modal,
            activeField: nextField,
            cursorPos: nextValue.length,
          },
        }
      }
      return state
    }
    case 'select-directory': {
      if (state.modal.type !== 'create-session') {
        return state
      }
      const selected = state.modal.directoryResults[state.modal.selectedIndex]
      if (!selected) {
        return state
      }
      const nameValue =
        state.modal.activeField === 'directory'
          ? state.modal.nameBuffer
          : (state.modal.editBuffer ?? '')
      const autoName = nameValue || basename(selected.path)
      return {
        ...state,
        modal: {
          ...state.modal,
          activeField: 'name',
          cursorPos: autoName.length,
          editBuffer: autoName,
          nameBuffer:
            state.modal.activeField === 'directory'
              ? (state.modal.editBuffer ?? '')
              : state.modal.nameBuffer,
          pendingProjectPath: selected.path,
        },
      }
    }
    case 'open-rename-tab-modal': {
      const activeTab =
        state.activeTabId != null && state.activeTabId !== ''
          ? state.tabs.find((tab) => tab.id === state.activeTabId)
          : undefined
      if (!activeTab) {
        return state
      }
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          cursorPos: activeTab.title.length,
          editBuffer: activeTab.title,
          selectedIndex: 0,
          sessionTargetId: activeTab.id,
          type: 'rename-tab',
        },
      }
    }
    case 'open-rename-worktree-modal': {
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          cursorPos: action.initialName.length,
          editBuffer: action.initialName,
          selectedIndex: 0,
          sessionTargetId: action.worktreeId,
          type: 'rename-worktree',
          worktreeSessionId: action.sessionId,
        },
      }
    }
    default:
      return null
  }
}
