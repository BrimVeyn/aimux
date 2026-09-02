import type { AppState, FocusMode, ModalType } from '../../state/types'
import type { ModeId } from './types'

type SupportedModalType = Exclude<ModalType, null>

const DIRECT_FOCUS_MODE_IDS: Partial<Record<FocusMode, ModeId>> = {
  'git': 'git-mode',
  'navigation': 'navigation',
  'settings': 'settings',
  'stats': 'stats',
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
  'setting-text': 'modal.setting-text',
  'settings-search': 'modal.settings-search.filtering',
  'snippet-editor': 'modal.snippet-editor',
  'snippet-picker': 'modal.snippet-picker.filtering',
  'split-picker': 'modal.split-picker',
  'theme-picker': 'modal.theme-picker.filtering',
}

const MODAL_MODE_IDS: Partial<Record<SupportedModalType, ModeId>> = {
  'quotas': 'modal.quotas',
  'update-available': 'modal.update-available',
  'workspace-delete-confirm': 'modal.workspace-delete-confirm',
  'workspace-move': 'modal.workspace-move',
  'workspace-move-confirm': 'modal.workspace-move-confirm',
}

/**
 * A derivation a plugin installs to claim input while its own UI is up.
 * Returns the mode to route to, or null to defer to the built-in rules.
 *
 * Consulted before anything else, because that is the only useful position: a
 * plugin view or modal renders on top, so it has to be able to take input from
 * whatever is underneath — which is exactly what `help` and `flash-jump` do
 * below, only hard-coded.
 */
export type ModeDerivation = (state: AppState) => ModeId | null

const derivations: ModeDerivation[] = []

/**
 * Registers a derivation. Returns the disposer the plugin's fiber holds, so an
 * unloaded plugin stops claiming input rather than routing keys into a mode
 * with no handler.
 */
export function registerModeDerivation(derivation: ModeDerivation): () => void {
  derivations.push(derivation)
  return () => {
    const index = derivations.indexOf(derivation)
    if (index !== -1) derivations.splice(index, 1)
  }
}

/** Test seam. Never called by the app. */
export function clearModeDerivations(): void {
  derivations.length = 0
}

export function deriveModeId(state: AppState): ModeId {
  // Snapshot: a derivation that unregisters itself must not shift the list
  // under the loop.
  const claimants = [...derivations]
  for (const derive of claimants) {
    const claimed = derive(state)
    if (claimed !== null) return claimed
  }

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
  if (directMode !== undefined) {
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
    const commandEditMode = modalType === null ? undefined : COMMAND_EDIT_MODE_IDS[modalType]
    if (commandEditMode !== undefined) {
      return commandEditMode
    }

    return 'navigation'
  }

  if (state.focusMode === 'modal') {
    if (state.modal.type === 'git-commit' && state.modal.stage === 'generating') {
      return 'modal.git-commit.generating'
    }
    const modalType = state.modal.type
    const modalMode = modalType === null ? undefined : MODAL_MODE_IDS[modalType]
    if (modalMode !== undefined) {
      return modalMode
    }

    return 'navigation'
  }

  return 'navigation'
}
