import type { AppState, FocusMode, ModalType } from '../../state/types'
import type { ModeId } from './types'

type SupportedModalType = Exclude<ModalType, null>

const DIRECT_FOCUS_MODE_IDS: Partial<Record<FocusMode, ModeId>> = {
  'git': 'git-mode',
  'navigation': 'navigation',
  'settings': 'settings',
  'terminal-input': 'terminal-input',
}

const COMMAND_EDIT_MODE_IDS: Partial<Record<SupportedModalType, ModeId>> = {
  'create-project': 'modal.create-project',
  'create-workspace': 'modal.create-workspace',
  'git-commit': 'modal.git-commit',
  'help': 'modal.help.filtering',
  'new-tab': 'modal.new-tab.command-edit',
  'project-name': 'modal.project-name',
  'project-picker': 'modal.project-picker.filtering',
  'rename-tab': 'modal.rename-tab',
  'rename-workspace': 'modal.rename-workspace',
  'snippet-editor': 'modal.snippet-editor',
  'snippet-picker': 'modal.snippet-picker.filtering',
  'split-picker': 'modal.split-picker',
  'theme-picker': 'modal.theme-picker.filtering',
}

const MODAL_MODE_IDS: Partial<Record<SupportedModalType, ModeId>> = {
  'ai-usage': 'modal.ai-usage',
  'update-available': 'modal.update-available',
  'workspace-delete-confirm': 'modal.workspace-delete-confirm',
  'workspace-move': 'modal.workspace-move',
  'workspace-move-confirm': 'modal.workspace-move-confirm',
}

export function deriveModeId(state: AppState): ModeId {
  // Help renders as an overlay on top of git/navigation without flipping
  // focusMode, so it needs modal-first dispatch. Always in filter mode.
  if (state.modal.type === 'help') {
    return 'modal.help.filtering'
  }

  // Overlay on top of git mode without flipping focusMode (like help) — route
  // input to the picker while it's open even though focus stays 'git'.
  if (state.modal.type === 'workspace-move') {
    return 'modal.workspace-move'
  }

  // Flash-jump overlay: same pattern — renders on top of navigation, all
  // letter keys are passthrough'd to update-command-edit for buffer matching.
  if (state.modal.type === 'flash-jump') {
    return 'modal.flash-jump'
  }

  const directMode = DIRECT_FOCUS_MODE_IDS[state.focusMode]
  if (directMode) {
    return directMode
  }

  if (state.focusMode === 'command-edit') {
    if (state.modal.type === 'new-tab' && state.modal.editingCommand !== null) {
      return 'modal.new-tab.editing-command'
    }
    if (state.modal.type === 'git-commit' && state.modal.stage === 'confirm') {
      return 'modal.git-commit.confirm'
    }
    const modalType = state.modal.type
    const commandEditMode = modalType ? COMMAND_EDIT_MODE_IDS[modalType] : undefined
    if (commandEditMode) {
      return commandEditMode
    }

    return 'navigation'
  }

  if (state.focusMode === 'modal') {
    if (state.modal.type === 'git-commit' && state.modal.stage === 'generating') {
      return 'modal.git-commit.generating'
    }
    const modalType = state.modal.type
    const modalMode = modalType ? MODAL_MODE_IDS[modalType] : undefined
    if (modalMode) {
      return modalMode
    }

    return 'navigation'
  }

  return 'navigation'
}
