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

/**
 * The mode each modal answers to, exhaustive over `ModalType` so adding a modal
 * without saying what handles it does not compile. Which of the two subspaces a
 * modal used to open in (`command-edit` or `modal`) is irrelevant here: the
 * modal decides the keyboard on its own, so there is one entry per modal.
 *
 * `plugin-modal` is the exception the type cannot state: its mode is registered
 * by the plugin and claimed by a derivation, so no built-in mode can be named.
 */
const MODAL_MODE_IDS: Record<SupportedModalType, ModeId | null> = {
  'create-project': 'modal.create-project',
  'create-workspace': 'modal.create-workspace',
  'flash-jump': 'modal.flash-jump',
  'git-commit': 'modal.git-commit',
  'help': 'modal.help.filtering',
  'new-tab': 'modal.new-tab.command-edit',
  'plugin-modal': null,
  'project-name': 'modal.project-name',
  'project-picker': 'modal.project-picker.filtering',
  'quotas': 'modal.quotas',
  'rename-tab': 'modal.rename-tab',
  'rename-workspace': 'modal.rename-workspace',
  'setting-keybind': 'modal.setting-keybind',
  'setting-text': 'modal.setting-text',
  'settings-search': 'modal.settings-search.filtering',
  'snippet-editor': 'modal.snippet-editor',
  'snippet-picker': 'modal.snippet-picker.filtering',
  'split-picker': 'modal.split-picker',
  'theme-picker': 'modal.theme-picker.filtering',
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
 * whatever is underneath — the same claim every built-in modal makes in
 * `MODAL_MODE_IDS`.
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

  // An open modal owns the keyboard, whatever `focusMode` currently says.
  // `focusMode` records the intent of whoever opened the modal, but it is an
  // ordinary slice: a chained launch, a restart, or a backend re-attach can
  // rewrite it while the modal is still up. Reading `focusMode` first then
  // leaves the modal on screen and deaf to every key, Esc included — the only
  // way out being to restart. So the modal decides, and focusMode only speaks
  // for the screens that have no modal over them.
  const modalMode = modalInputModeId(state)
  if (modalMode !== null) {
    return modalMode
  }

  const directMode = DIRECT_FOCUS_MODE_IDS[state.focusMode]
  if (directMode !== undefined) {
    return directMode
  }

  return 'navigation'
}

/**
 * The mode an open modal answers to, or null when it owns no keyboard of its
 * own — an overlay claimed by a derivation, or a plugin modal whose plugin is
 * not loaded.
 */
function modalInputModeId(state: AppState): ModeId | null {
  const { modal } = state
  if (modal.type === null) return null

  // Two modals answer to a sub-mode that is not the one they open in.
  if (modal.type === 'git-commit') {
    if (modal.stage === 'generating') return 'modal.git-commit.generating'
    if (modal.stage === 'confirm') return 'modal.git-commit.confirm'
  }
  if (modal.type === 'new-tab' && modal.editingCommand !== null) {
    return 'modal.new-tab.editing-command'
  }

  return MODAL_MODE_IDS[modal.type]
}
