import type { AppState, FocusMode, ModalType } from '../../state/types'
import type { ModeId } from './types'

type SupportedModalType = Exclude<ModalType, null>

const DIRECT_FOCUS_MODE_IDS: Partial<Record<FocusMode, ModeId>> = {
  'git': 'git-mode',
  'layout': 'layout',
  'navigation': 'navigation',
  'terminal-input': 'terminal-input',
}

const COMMAND_EDIT_MODE_IDS: Partial<Record<SupportedModalType, ModeId>> = {
  'create-session': 'modal.create-session',
  'git-commit': 'modal.git-commit',
  'new-tab': 'modal.new-tab.command-edit',
  'rename-tab': 'modal.rename-tab',
  'session-name': 'modal.session-name',
  'session-picker': 'modal.session-picker.filtering',
  'snippet-editor': 'modal.snippet-editor',
  'snippet-picker': 'modal.snippet-picker.filtering',
}

const MODAL_MODE_IDS: Partial<Record<SupportedModalType, ModeId>> = {
  'help': 'modal.help',
  'new-tab': 'modal.new-tab',
  'session-picker': 'modal.session-picker',
  'snippet-picker': 'modal.snippet-picker',
  'split-picker': 'modal.split-picker',
  'theme-picker': 'modal.theme-picker',
}

export function deriveModeId(state: AppState): ModeId {
  const directMode = DIRECT_FOCUS_MODE_IDS[state.focusMode]
  if (directMode) {
    return directMode
  }

  if (state.focusMode === 'command-edit') {
    const modalType = state.modal.type
    const commandEditMode = modalType ? COMMAND_EDIT_MODE_IDS[modalType] : undefined
    if (commandEditMode) {
      return commandEditMode
    }

    return 'navigation'
  }

  if (state.focusMode === 'modal') {
    const modalType = state.modal.type
    const modalMode = modalType ? MODAL_MODE_IDS[modalType] : undefined
    if (modalMode) {
      return modalMode
    }

    return 'navigation'
  }

  return 'navigation'
}
