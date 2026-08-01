import { basename } from 'node:path'

import type { AppAction } from '../actions'
import type { AppState } from '../types'

import { collectHelpEntries } from '../../input/keymap/help-entries'
import { getActiveKeymap } from '../../input/keymap/keymap-ref'
import { getAllAssistantOptions } from '../../pty/command-registry'
import { filterSettingRows } from '../../settings/search'
import { filterThemeIds } from '../../ui/filter-themes'
import { buildFlashJumpLabels } from '../../ui/flash/build-labels'
import {
  type BaseRefOption,
  buildBaseRefOptions,
  filterProjects,
  filterSnippets,
  getNewTabAssistantOptions,
} from '../selectors'
import { reduceAutoCommitState } from './auto-commit-state'

function emptyModal() {
  return {
    cursorPos: 0,
    editBuffer: null,
    projectTargetId: null,
    selectedIndex: 0,
    type: null,
  } as const
}

export { emptyModal }

function clampCursor(value: number, max: number): number {
  return Math.max(0, Math.min(max, value))
}

function getCurrentWorkspaceCount(state: AppState): number {
  if (!(state.currentProjectId != null && state.currentProjectId !== '')) return 0
  return (
    state.projects.find((entry) => entry.id === state.currentProjectId)?.workspaces?.length ?? 0
  )
}

function getCreateWorkspaceBaseOptions(state: AppState, queryOverride?: string): BaseRefOption[] {
  if (state.modal.type !== 'create-workspace') return []
  const workspaces =
    state.projects.find((entry) => entry.id === state.currentProjectId)?.workspaces ?? []
  return buildBaseRefOptions(
    workspaces,
    state.modal.baseBranches,
    queryOverride ?? state.modal.baseQuery
  )
}

/**
 * How many rows the open modal's list has, for the two cases that move the
 * selection through it. They read the same list, so they read it from here:
 * two copies of this chain drift apart the moment one modal's list changes.
 * Modals whose list is not indexed this way (create-workspace's own fields,
 * flash-jump) return 0 and are handled by their case before it gets here.
 */
function getModalOptionCount(state: AppState): number {
  const { modal } = state
  switch (modal.type) {
    case 'create-project':
      return modal.directoryResults.length
    case 'help':
      return modal.entryCount
    case 'new-tab':
      return getNewTabAssistantOptions(
        state.customCommands,
        modal.editBuffer,
        modal.pendingWorkspace != null
      ).length
    case 'project-picker':
      // `+1` for the "create a project" row the picker appends, and at least
      // that row exists even when nothing matches the filter.
      return Math.max(1, filterProjects(state.projects, modal.editBuffer).length + 1)
    case 'settings-search':
      return filterSettingRows(state.projects, modal.editBuffer).length
    case 'snippet-picker':
      return filterSnippets(state.snippets, modal.editBuffer).length
    case 'split-picker':
      return getAllAssistantOptions(state.customCommands).length
    case 'theme-picker':
      return filterThemeIds(modal.editBuffer).length
    case 'update-available':
      return 2
    case 'workspace-move':
      // Every workspace but the one being moved.
      return Math.max(0, getCurrentWorkspaceCount(state) - 1)
    default:
      return 0
  }
}

const CREATE_WORKSPACE_FIELDS = ['prompt', 'base'] as const

type CreateWorkspaceField = (typeof CREATE_WORKSPACE_FIELDS)[number]

/** The buffer a create-workspace field edits, so cursor math has one source. */
function getCreateWorkspaceFieldValue(
  modal: { prompt: string; baseQuery: string },
  field: CreateWorkspaceField
): string {
  return field === 'prompt' ? modal.prompt : modal.baseQuery
}

export function reduceModalState(state: AppState, action: AppAction): AppState | null {
  switch (action.type) {
    case 'open-new-tab-modal': {
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          cursorPos: 0,
          editBuffer: '',
          editingCommand: null,
          pendingPrompt: action.pendingPrompt,
          pendingWorkspace: action.pendingWorkspace,
          projectTargetId: null,
          selectedIndex: 0,
          type: 'new-tab',
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
          projectTargetId: null,
          selectedIndex: 0,
          type: 'ai-usage',
        },
      }
    }
    case 'open-workspace-move-modal': {
      // Overlay: keep focusMode (git when opened via `m`, navigation when opened
      // from a tab menu) so the view underneath stays mounted, like the help
      // modal. deriveModeId routes input to the picker while open.
      return {
        ...state,
        modal: {
          deleteSource: false,
          editBuffer: null,
          projectTargetId: null,
          selectedIndex: 0,
          sourceWorkspaceId: action.sourceWorkspaceId,
          stats: { kind: 'loading' },
          type: 'workspace-move',
        },
      }
    }
    case 'toggle-workspace-move-delete': {
      if (state.modal.type !== 'workspace-move') return state
      return {
        ...state,
        modal: { ...state.modal, deleteSource: !state.modal.deleteSource },
      }
    }
    case 'set-workspace-move-stats': {
      if (state.modal.type !== 'workspace-move') return state
      return {
        ...state,
        modal: { ...state.modal, stats: { dirtyFiles: action.dirtyFiles, kind: 'ready' } },
      }
    }
    case 'open-workspace-move-confirm': {
      return {
        ...state,
        focusMode: 'modal',
        modal: {
          deleteSource: action.deleteSource,
          editBuffer: null,
          files: action.files,
          projectId: action.projectId,
          projectTargetId: null,
          selectedIndex: 0,
          sourceLabel: action.sourceLabel,
          sourceWorkspaceId: action.sourceWorkspaceId,
          targetLabel: action.targetLabel,
          targetWorkspaceId: action.targetWorkspaceId,
          type: 'workspace-move-confirm',
          variant: action.variant,
        },
      }
    }
    case 'open-workspace-delete-confirm': {
      return {
        ...state,
        focusMode: 'modal',
        modal: {
          closeTabs: action.closeTabs,
          editBuffer: null,
          force: action.force,
          projectId: action.projectId,
          projectTargetId: null,
          reason: action.reason,
          selectedIndex: 0,
          type: 'workspace-delete-confirm',
          workspaceId: action.workspaceId,
          workspaceLabel: action.workspaceLabel,
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
          projectTargetId: null,
          selectedIndex: 0,
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
          projectTargetId: null,
          scope,
          selectedIndex: 0,
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
          projectTargetId: null,
          selectedIndex: 0,
          splitDirection: action.direction,
          type: 'split-picker',
        },
      }
    case 'open-project-picker':
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          cursorPos: 0,
          editBuffer: '',
          projectTargetId: null,
          selectedIndex: 0,
          type: 'project-picker',
        },
      }
    case 'open-project-name-modal': {
      const initialName = action.initialName ?? ''
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          cursorPos: initialName.length,
          editBuffer: initialName,
          projectTargetId: action.projectTargetId ?? null,
          returnToProjectPicker: action.returnToProjectPicker ?? true,
          selectedIndex: 0,
          type: 'project-name',
        },
      }
    }
    case 'open-create-project-modal':
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
          projectTargetId: null,
          returnToProjectPicker: action.returnToProjectPicker,
          selectedIndex: 0,
          type: 'create-project',
        },
      }
    case 'set-directory-results': {
      if (state.modal.type !== 'create-project') {
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
    case 'open-create-workspace-modal':
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          activeField: 'prompt',
          baseBranches: [],
          baseQuery: '',
          // Left empty on purpose: `load-create-workspace-base-branches`
          // resolves the repo's default branch and backfills it below. Seeding
          // the active workspace's branch here would win over that.
          baseRef: '',
          branchError: null,
          cursorPos: 0,
          editBuffer: '',
          projectTargetId: null,
          prompt: '',
          selectedIndex: 0,
          type: 'create-workspace',
        },
      }
    case 'switch-create-workspace-field': {
      if (state.modal.type !== 'create-workspace') return state
      const next =
        CREATE_WORKSPACE_FIELDS[
          (CREATE_WORKSPACE_FIELDS.indexOf(state.modal.activeField) + 1) %
            CREATE_WORKSPACE_FIELDS.length
        ] ?? 'prompt'
      const buffer = getCreateWorkspaceFieldValue(state.modal, next)
      // Entering the base field highlights the row matching the resolved ref,
      // so the picker opens on what the form already says it will fork from.
      const baseIndex =
        next === 'base'
          ? Math.max(
              0,
              getCreateWorkspaceBaseOptions(state).findIndex(
                (option) => option.ref === (state.modal as { baseRef: string }).baseRef
              )
            )
          : 0
      return {
        ...state,
        modal: {
          ...state.modal,
          activeField: next,
          cursorPos: buffer.length,
          selectedIndex: baseIndex,
        },
      }
    }
    case 'set-create-workspace-base-branches': {
      if (state.modal.type !== 'create-workspace') return state
      const modalWithBranches = { ...state.modal, baseBranches: action.branches }
      const withBranches: AppState = { ...state, modal: modalWithBranches }
      // The user may already have typed a base while this was in flight.
      if (state.modal.baseRef !== '') return withBranches
      // Fork from the repo's default branch, falling back to the most recently
      // committed one when the repo has neither an origin/HEAD nor a main.
      const fallback = getCreateWorkspaceBaseOptions(withBranches)[0]?.ref ?? ''
      const defaultBranch =
        action.defaultBranch != null && action.branches.includes(action.defaultBranch)
          ? action.defaultBranch
          : fallback
      return {
        ...withBranches,
        modal: { ...modalWithBranches, baseRef: defaultBranch },
      }
    }
    case 'set-create-workspace-branch-error': {
      if (state.modal.type !== 'create-workspace') return state
      return {
        ...state,
        modal: {
          ...state.modal,
          // The branch is generated now, so there is no branch field to focus:
          // send the user back to the prompt, which is what produced the name.
          activeField: 'prompt',
          branchError: action.message,
          cursorPos: state.modal.prompt.length,
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
          projectTargetId: null,
          returnTo: action.returnTo,
          selectedIndex: 0,
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
          projectTargetId: snippet?.id ?? null,
          selectedIndex: 0,
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
          projectTargetId: null,
          returnTo: action.returnTo,
          selectedIndex: 0,
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
          projectTargetId: null,
          selectedIndex: 0,
          type: 'update-available',
        },
      }
    case 'open-git-commit-modal': {
      const projectId = action.projectId
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          activeField: 'title',
          contentBuffer: '',
          cursorPos: 0,
          editBuffer: '',
          projectTargetId: projectId ?? null,
          selectedIndex: 0,
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
        modal: { ...state.modal, projectTargetId: action.projectId, stage: 'generating' },
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
        state.modal.projectTargetId !== action.projectId
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
      if (state.modal.type !== 'git-commit' || state.modal.projectTargetId !== action.projectId) {
        return null
      }
      const suggestion = state.autoCommit.byProject[action.projectId]
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
        state.modal.projectTargetId !== action.projectId
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
        closingType === 'workspace-move' ||
        closingType === 'flash-jump'
      ) {
        return { ...state, modal: emptyModal() }
      }
      // Whoever opened it said where to go back to — the settings screen does,
      // because it is still drawn behind. The commit modal predates that and
      // still names git mode itself.
      const nextFocus: AppState['focusMode'] =
        state.modal.returnTo ?? (closingType === 'git-commit' ? 'git' : 'navigation')
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
        state.modal.type !== 'project-picker' &&
        state.modal.type !== 'snippet-picker' &&
        state.modal.type !== 'theme-picker' &&
        state.modal.type !== 'create-project' &&
        state.modal.type !== 'create-workspace' &&
        state.modal.type !== 'split-picker' &&
        state.modal.type !== 'update-available' &&
        state.modal.type !== 'workspace-move'
      ) {
        return state
      }
      if (state.modal.type === 'create-project' && state.modal.activeField !== 'directory') {
        return state
      }
      if (state.modal.type === 'create-workspace') {
        if (state.modal.activeField !== 'base') return state
        const options = getCreateWorkspaceBaseOptions(state)
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
      const optionCount = getModalOptionCount(state)
      if (optionCount === 0) {
        return state
      }
      return {
        ...state,
        modal: {
          ...state.modal,
          selectedIndex: (state.modal.selectedIndex + action.delta + optionCount) % optionCount,
        },
      }
    }
    case 'set-modal-selection-index': {
      if (
        state.modal.type !== 'new-tab' &&
        state.modal.type !== 'project-picker' &&
        state.modal.type !== 'snippet-picker' &&
        state.modal.type !== 'theme-picker' &&
        state.modal.type !== 'create-project' &&
        state.modal.type !== 'create-workspace' &&
        state.modal.type !== 'split-picker' &&
        state.modal.type !== 'update-available' &&
        state.modal.type !== 'workspace-move' &&
        state.modal.type !== 'help'
      ) {
        return state
      }
      if (state.modal.type === 'create-workspace') {
        if (state.modal.activeField !== 'base') return state
        const options = getCreateWorkspaceBaseOptions(state)
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
      const optionCount = getModalOptionCount(state)
      if (optionCount === 0) return state
      const clamped = Math.max(0, Math.min(optionCount - 1, action.index))
      if (clamped === state.modal.selectedIndex) return state
      return { ...state, modal: { ...state.modal, selectedIndex: clamped } }
    }
    case 'move-modal-cursor': {
      if (state.modal.editBuffer === null) return state
      const len = state.modal.editBuffer.length
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
      if (state.modal.type === 'create-workspace') {
        const field = state.modal.activeField
        const current = getCreateWorkspaceFieldValue(state.modal, field)
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
        if (field === 'prompt') {
          return {
            ...state,
            modal: { ...state.modal, branchError: null, cursorPos: pos, prompt: text },
          }
        }
        // Re-filter and snap the base to the top match as the query changes.
        const topOption = getCreateWorkspaceBaseOptions(state, text)[0]
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
      const buffer = state.modal.editBuffer
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
      const resetIndex =
        !isNewTabEditing &&
        (state.modal.type === 'project-picker' ||
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
      if (state.modal.type === 'create-project' || state.modal.type === 'snippet-editor') {
        return { ...state, focusMode: 'navigation', modal: emptyModal() }
      }
      // Pickers and overlays with auto-filter — Esc closes the modal entirely.
      if (
        state.modal.type === 'project-picker' ||
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
    case 'switch-create-project-field': {
      if (state.modal.type === 'create-project') {
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
      return state
    }
    case 'select-directory': {
      if (state.modal.type !== 'create-project') {
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
    case 'open-settings-search':
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          cursorPos: 0,
          editBuffer: '',
          projectTargetId: null,
          returnTo: 'settings',
          selectedIndex: 0,
          type: 'settings-search',
        },
      }
    case 'open-setting-text-modal':
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          cursorPos: action.value.length,
          editBuffer: action.value,
          projectTargetId: null,
          returnTo: 'settings',
          selectedIndex: 0,
          settingId: action.settingId,
          settingLabel: action.label,
          type: 'setting-text',
        },
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
          projectTargetId: activeTab.id,
          selectedIndex: 0,
          type: 'rename-tab',
        },
      }
    }
    case 'open-rename-workspace-modal': {
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          cursorPos: action.initialName.length,
          editBuffer: action.initialName,
          projectTargetId: action.workspaceId,
          selectedIndex: 0,
          type: 'rename-workspace',
          workspaceProjectId: action.projectId,
        },
      }
    }
    default:
      return null
  }
}
