import type { AppState, FocusMode, ModalType } from '../../state/types'
import type { ModeId } from './types'

type SupportedModalType = Exclude<ModalType, null>

const DIRECT_FOCUS_MODE_IDS: Partial<Record<FocusMode, ModeId>> = {
  'git': 'git-mode',
  'navigation': 'navigation',
  'terminal-input': 'terminal-input',
}

const COMMAND_EDIT_MODE_IDS: Partial<Record<SupportedModalType, ModeId>> = {
  'create-session': 'modal.create-session',
  'git-commit': 'modal.git-commit',
  'help': 'modal.help.filtering',
  'new-tab': 'modal.new-tab.command-edit',
  'rename-tab': 'modal.rename-tab',
  'session-name': 'modal.session-name',
  'session-picker': 'modal.session-picker.filtering',
  'snippet-editor': 'modal.snippet-editor',
  'snippet-picker': 'modal.snippet-picker.filtering',
  'theme-picker': 'modal.theme-picker.filtering',
}

const MODAL_MODE_IDS: Partial<Record<SupportedModalType, ModeId>> = {
  'split-picker': 'modal.split-picker',
  'update-available': 'modal.update-available',
}

export function deriveModeId(state: AppState): ModeId {
  // Help renders as an overlay on top of git/navigation without flipping
  // focusMode, so it needs modal-first dispatch. Always in filter mode.
  if (state.modal.type === 'help') {
    return 'modal.help.filtering'
  }

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
