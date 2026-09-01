import type { AppAction } from '../actions'
import type { AppState } from '../types'

import { reduceAutoCommitState } from './auto-commit-state'

/**
 * The commit modal: its four stages, and the two ways a background auto-commit
 * suggestion lands in it.
 *
 * Its own file because it is the one modal with a stage machine of its own — the
 * others are a buffer and a selection — and because `modal-state.ts` was within a
 * few dozen lines of the 1000-line ceiling.
 *
 * Returns `null` on an action it does not handle, and also when a `git-commit`
 * action arrives with no commit modal open, or with a stale project: those are for
 * `reduceAutoCommit` further down the chain, which owns the slice without caring
 * what is on screen.
 */
export function reduceGitCommitModalState(state: AppState, action: AppAction): AppState | null {
  switch (action.type) {
    case 'open-git-commit-modal':
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          activeField: 'title',
          contentBuffer: '',
          cursorPos: 0,
          editBuffer: '',
          projectTargetId: action.projectId ?? null,
          // Git mode is what is drawn behind it, and closing has always gone back
          // there. Said here rather than in `close-modal`, so that reducer has one
          // rule instead of a rule and this exception.
          returnTo: 'git',
          selectedIndex: 0,
          stage: 'edit',
          type: 'git-commit',
        },
      }
    case 'git-commit-enter-confirm':
      if (state.modal.type !== 'git-commit') return state
      return { ...state, focusMode: 'command-edit', modal: { ...state.modal, stage: 'confirm' } }
    case 'git-commit-leave-confirm':
      if (state.modal.type !== 'git-commit') return state
      return { ...state, focusMode: 'command-edit', modal: { ...state.modal, stage: 'edit' } }
    case 'git-commit-enter-generating':
      if (state.modal.type !== 'git-commit') return state
      return {
        ...state,
        focusMode: 'modal',
        modal: { ...state.modal, projectTargetId: action.projectId, stage: 'generating' },
      }
    case 'git-commit-leave-generating':
      if (state.modal.type !== 'git-commit') return state
      return { ...state, focusMode: 'command-edit', modal: { ...state.modal, stage: 'edit' } }
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
        // strand the modal in `generating` — flip back to edit so the user isn't
        // stuck staring at a spinner that will never resolve.
        return { ...state, focusMode: 'command-edit', modal: { ...state.modal, stage: 'edit' } }
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
      return {
        ...state,
        autoCommit: reduceAutoCommitState(state.autoCommit, action) ?? state.autoCommit,
        focusMode: 'command-edit',
        modal: { ...state.modal, stage: 'edit' },
      }
    }
    default:
      return null
  }
}
